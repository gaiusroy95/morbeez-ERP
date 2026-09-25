import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { VehiclesRepository } from './repositories/vehicles.repository';
import { VehicleRecord, VehicleStatus } from './entities/vehicle.entity';
import { PaginatedResult } from '../../common/persistence/pagination';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';

const ENTITY_TYPE = 'vehicle';

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
