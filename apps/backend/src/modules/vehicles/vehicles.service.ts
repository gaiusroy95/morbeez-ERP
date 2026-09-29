import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { VehiclesRepository } from './repositories/vehicles.repository';
import { VehicleRecord, VehicleStatus } from './entities/vehicle.entity';
import { PaginatedResult } from '../../common/persistence/pagination';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';

const ENTITY_TYPE = 'vehicle';

const isoDay = (v: string | Date | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

@Injectable()
export class VehiclesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly vehicles: VehiclesRepository,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, page: number, pageSize: number): Promise<PaginatedResult<VehicleRecord>> {
    return this.vehicles.list(tenantId, page, pageSize);
  }

  async getById(tenantId: string, id: string): Promise<VehicleRecord> {
    const vehicle = await this.vehicles.findById(tenantId, id);
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }

  create(tenantId: string, actorUserId: string, dto: CreateVehicleDto): Promise<VehicleRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const vehicle = await this.vehicles.createWithClient(client, tenantId, actorUserId, {
        registrationNumber: dto.registrationNumber,
        capacityKg: dto.capacityKg,
        fuelType: dto.fuelType,
        acquisitionCost: dto.acquisitionCost,
        acquisitionDate: dto.acquisitionDate,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: ENTITY_TYPE,
        entityId: vehicle.id,
        after: vehicle as unknown as Record<string, unknown>,
      });
      return vehicle;
    });
  }

  update(
    tenantId: string,
    actorUserId: string,
    id: string,
    dto: UpdateVehicleDto,
  ): Promise<VehicleRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.vehicles.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Vehicle not found');
      const books = await this.vehicles.bookStateWithClient(client, id);
      if (
        books.onBooks &&
        ((dto.acquisitionCost !== undefined && Number(dto.acquisitionCost) !== Number(before.acquisitionCost)) ||
          (dto.acquisitionDate !== undefined && dto.acquisitionDate.slice(0, 10) !== isoDay(before.acquisitionDate)))
      ) {
        throw new ConflictException('The acquisition cost and date come from the asset register once the vehicle is capitalised');
      }

      const after = await this.vehicles.updateWithClient(client, id, dto.version, {
        registrationNumber: dto.registrationNumber,
        capacityKg: dto.capacityKg,
        fuelType: dto.fuelType,
        acquisitionCost: dto.acquisitionCost,
        acquisitionDate: dto.acquisitionDate,
      });

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: ENTITY_TYPE,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  setStatus(
    tenantId: string,
    actorUserId: string,
    id: string,
    status: VehicleStatus,
  ): Promise<VehicleRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.vehicles.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Vehicle not found');
      // VEH.5: an asset leaves the books only through its disposal event,
      // which records proceeds and the gain or loss — and can't be undone.
      const books = await this.vehicles.bookStateWithClient(client, id);
      if (books.disposalRecorded && status !== 'disposed') {
        throw new ConflictException('This vehicle has been disposed of — that is final');
      }
      if (books.onBooks && !books.disposalRecorded && status === 'disposed') {
        throw new ConflictException('This vehicle is on the books — record its disposal under Vehicles › Asset, with the proceeds');
      }

      const after = await this.vehicles.setStatusWithClient(client, id, status);
      if (!after) throw new NotFoundException('Vehicle not found');

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        // "update" here, not "archive"/"restore" — a three-state status
        // transition isn't a binary archive/restore, so it's tracked as a
        // regular field update, distinguishable in before/after either way.
        action: 'update',
        entityType: ENTITY_TYPE,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }
}
