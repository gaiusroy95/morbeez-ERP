import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { ProductsService } from '../products/products.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { ProcurementService } from '../procurement/procurement.service';
import { LocationsRepository } from './repositories/locations.repository';
import { InventoryMovementsRepository } from './repositories/inventory-movements.repository';
import { LocationRecord, LocationType } from './entities/location.entity';
import { InventoryMovementRecord, MovementType, StockSummary } from './entities/inventory-movement.entity';
import { LotRecord } from '../procurement/entities/lot.entity';
import { PaginatedResult } from '../../common/persistence/pagination';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { RecordShrinkageDto } from './dto/record-shrinkage.dto';
import { RecordRejectionDto } from './dto/record-rejection.dto';
import { TransferLotDto } from './dto/transfer-lot.dto';

const LOCATION_ENTITY = 'location';

@Injectable()
export class InventoryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly locations: LocationsRepository,
    private readonly movements: InventoryMovementsRepository,
    private readonly products: ProductsService,
    private readonly vehicles: VehiclesService,
    private readonly procurement: ProcurementService,
    private readonly audit: AuditService,
  ) {}

  // ---- Locations ----

  listLocations(tenantId: string, page: number, pageSize: number): Promise<PaginatedResult<LocationRecord>> {
    return this.locations.list(tenantId, page, pageSize);
  }

  async getLocation(tenantId: string, id: string): Promise<LocationRecord> {
    const location = await this.locations.findById(tenantId, id);
    if (!location) throw new NotFoundException('Location not found');
    return location;
  }

  async createLocation(tenantId: string, actorUserId: string, dto: CreateLocationDto): Promise<LocationRecord> {
    const type: LocationType = dto.type ?? 'warehouse';
    let vehicleId: string | null = null;

    if (type === 'vehicle') {
      if (!dto.vehicleId) throw new BadRequestException('vehicleId is required for a vehicle location');
      const vehicle = await this.vehicles.getById(tenantId, dto.vehicleId);
      if (vehicle.status !== 'active') throw new ConflictException('Vehicle is not active');
      vehicleId = dto.vehicleId;
    } else if (dto.vehicleId) {
      throw new BadRequestException("vehicleId may only be set when type is 'vehicle'");
    }

    return this.db.withTenant(tenantId, async (client) => {
      const location = await this.locations.createWithClient(client, tenantId, actorUserId, {
        name: dto.name,
        type,
        vehicleId,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: LOCATION_ENTITY,
        entityId: location.id,
        after: location as unknown as Record<string, unknown>,
      });
      return location;
    });
  }

  updateLocation(tenantId: string, actorUserId: string, id: string, dto: UpdateLocationDto): Promise<LocationRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.locations.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Location not found');

      const after = await this.locations.updateWithClient(client, id, dto.version, { name: dto.name });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: LOCATION_ENTITY,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  archiveLocation(tenantId: string, actorUserId: string, id: string): Promise<LocationRecord> {
    return this.setLocationStatus(tenantId, actorUserId, id, 'archived', 'archive');
  }

  restoreLocation(tenantId: string, actorUserId: string, id: string): Promise<LocationRecord> {
    return this.setLocationStatus(tenantId, actorUserId, id, 'active', 'restore');
  }

  private setLocationStatus(
    tenantId: string,
    actorUserId: string,
    id: string,
    status: 'active' | 'archived',
    action: 'archive' | 'restore',
  ): Promise<LocationRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.locations.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Location not found');

      const after = await this.locations.setStatusWithClient(client, id, status);
      if (!after) throw new NotFoundException('Location not found');

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action,
        entityType: LOCATION_ENTITY,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  // ---- Lot tracking: stock summary ----

  /**
   * available = physical - reserved (Inventory Engine's core formula).
   * physical counts every graded, still-in-stock lot (status 'available'
   * or 'reserved') at its current_quantity — a lot that's still
   * 'received_ungraded' isn't sellable stock yet, and a 'rejected' one
   * never was.
   */
  async getStockSummary(tenantId: string, productId: string): Promise<StockSummary> {
    await this.products.getById(tenantId, productId);
    const lots = await this.procurement.listLotsForProduct(tenantId, productId);

    let physical = 0;
    let reserved = 0;
    for (const lot of lots) {
      const quantity = Number(lot.currentQuantity ?? 0);
      if (lot.status === 'available') {
        physical += quantity;
      } else if (lot.status === 'reserved') {
        physical += quantity;
        reserved += quantity;
      }
    }

    return {
      productId,
      physical: physical.toFixed(3),
      reserved: reserved.toFixed(3),
      available: (physical - reserved).toFixed(3),
    };
  }

  async listLotsForProduct(tenantId: string, productId: string): Promise<LotRecord[]> {
    await this.products.getById(tenantId, productId);
    return this.procurement.listLotsForProduct(tenantId, productId);
  }

  // ---- Shrinkage / post-acceptance rejection ----

  async recordShrinkage(
    tenantId: string,
    actorUserId: string,
    lotId: string,
    dto: RecordShrinkageDto,
  ): Promise<LotRecord> {
    const lot = await this.procurement.recordShrinkage(tenantId, actorUserId, lotId, dto.version, dto.quantity);
    await this.writeMovement(tenantId, actorUserId, lot, 'shrinkage', dto.quantity, dto.reason ?? null);
    return lot;
  }

  async recordRejection(
    tenantId: string,
    actorUserId: string,
    lotId: string,
    dto: RecordRejectionDto,
  ): Promise<LotRecord> {
    const lot = await this.procurement.recordRejectionPostAcceptance(
      tenantId,
      actorUserId,
      lotId,
      dto.version,
      dto.quantity,
    );
    await this.writeMovement(tenantId, actorUserId, lot, 'rejected_post_acceptance', dto.quantity, dto.reason ?? null);
    return lot;
  }

  private writeMovement(
    tenantId: string,
    actorUserId: string,
    lot: LotRecord,
    movementType: MovementType,
    quantity: number,
    reason: string | null,
  ): Promise<InventoryMovementRecord> {
    return this.db.withTenant(tenantId, (client) =>
      this.movements.createWithClient(client, tenantId, actorUserId, {
        lotId: lot.id,
        productId: lot.productId,
        movementType,
        quantity,
        reason,
      }),
    );
  }

  // ---- Transfers ----

  async transferLot(tenantId: string, actorUserId: string, lotId: string, dto: TransferLotDto): Promise<LotRecord> {
    const toLocation = await this.getLocation(tenantId, dto.toLocationId);
    if (toLocation.status !== 'active') {
      throw new ConflictException('Destination location is not active');
    }

    const before = await this.procurement.getLot(tenantId, lotId);
    if (before.currentQuantity === null || Number(before.currentQuantity) <= 0) {
      throw new BadRequestException('Nothing left in this lot to transfer');
    }
    const fromLocationId = before.currentLocationId;

    const after = await this.procurement.transferLot(tenantId, actorUserId, lotId, dto.version, dto.toLocationId);

    await this.db.withTenant(tenantId, (client) =>
      this.movements.createWithClient(client, tenantId, actorUserId, {
        lotId: after.id,
        productId: after.productId,
        movementType: 'transferred',
        quantity: Number(after.currentQuantity ?? 0),
        fromLocationId,
        toLocationId: dto.toLocationId,
      }),
    );

    return after;
  }

  // ---- Movement history ----

  listMovementsForLot(
    tenantId: string,
    lotId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<InventoryMovementRecord>> {
    return this.movements.listByLot(tenantId, lotId, page, pageSize);
  }

  listMovementsForProduct(
    tenantId: string,
    productId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<InventoryMovementRecord>> {
    return this.movements.listByProduct(tenantId, productId, page, pageSize);
  }
}
