import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { FarmersRepository } from './repositories/farmers.repository';
import { FarmerRecord } from './entities/farmer.entity';
import { PaginatedResult } from '../../common/persistence/pagination';
import { CreateFarmerDto } from './dto/create-farmer.dto';
import { UpdateFarmerDto } from './dto/update-farmer.dto';

const ENTITY_TYPE = 'farmer';

@Injectable()
export class FarmersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly farmers: FarmersRepository,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, page: number, pageSize: number): Promise<PaginatedResult<FarmerRecord>> {
    return this.farmers.list(tenantId, page, pageSize);
  }

  async getById(tenantId: string, id: string): Promise<FarmerRecord> {
    const farmer = await this.farmers.findById(tenantId, id);
    if (!farmer) throw new NotFoundException('Farmer not found');
    return farmer;
  }

  create(tenantId: string, actorUserId: string, dto: CreateFarmerDto): Promise<FarmerRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const farmer = await this.farmers.createWithClient(client, tenantId, actorUserId, {
        name: dto.name,
        contact: dto.contact ?? {},
        bankDetails: dto.bankDetails,
      });
      // bank_details never appears in the audit entry itself, even
      // encrypted — the audit log's own retention/access story is
      // separate from this field's, and there's no reason to duplicate
      // sensitive data into a second table just to say "it changed."
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: ENTITY_TYPE,
        entityId: farmer.id,
        after: redactBankDetails(farmer),
      });
      return farmer;
    });
  }

  update(
    tenantId: string,
    actorUserId: string,
    id: string,
    dto: UpdateFarmerDto,
  ): Promise<FarmerRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.farmers.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Farmer not found');

      const after = await this.farmers.updateWithClient(client, id, dto.version, {
        name: dto.name,
        contact: dto.contact,
        bankDetails: dto.bankDetails,
        reliabilityRating: dto.reliabilityRating,
      });

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: ENTITY_TYPE,
        entityId: id,
        before: redactBankDetails(before),
        after: redactBankDetails(after),
      });
      return after;
    });
  }

  archive(tenantId: string, actorUserId: string, id: string): Promise<FarmerRecord> {
    return this.setStatus(tenantId, actorUserId, id, 'archived', 'archive');
  }

  restore(tenantId: string, actorUserId: string, id: string): Promise<FarmerRecord> {
    return this.setStatus(tenantId, actorUserId, id, 'active', 'restore');
  }

  private setStatus(
    tenantId: string,
    actorUserId: string,
    id: string,
    status: 'active' | 'archived',
    action: 'archive' | 'restore',
  ): Promise<FarmerRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.farmers.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Farmer not found');

      const after = await this.farmers.setStatusWithClient(client, id, status);
      if (!after) throw new NotFoundException('Farmer not found');

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action,
        entityType: ENTITY_TYPE,
        entityId: id,
        before: redactBankDetails(before),
        after: redactBankDetails(after),
      });
      return after;
    });
  }
}

function redactBankDetails(farmer: FarmerRecord): Record<string, unknown> {
  const { bankDetails: _bankDetails, ...rest } = farmer;
  return { ...rest, bankDetails: farmer.bankDetails ? '[redacted]' : null };
}
