import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { CustomersRepository } from './repositories/customers.repository';
import { CustomerRecord } from './entities/customer.entity';
import { PaginatedResult } from '../../common/persistence/pagination';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const ENTITY_TYPE = 'customer';

@Injectable()
export class CustomersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly customers: CustomersRepository,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, page: number, pageSize: number): Promise<PaginatedResult<CustomerRecord>> {
    return this.customers.list(tenantId, page, pageSize);
  }

  async getById(tenantId: string, id: string): Promise<CustomerRecord> {
    const customer = await this.customers.findById(tenantId, id);
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  create(tenantId: string, actorUserId: string, dto: CreateCustomerDto): Promise<CustomerRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const customer = await this.customers.createWithClient(client, tenantId, actorUserId, {
        name: dto.name,
        contact: { ...dto.contact },
        creditLimit: dto.creditLimit ?? 0,
        paymentTermsDays: dto.paymentTermsDays ?? 0,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: ENTITY_TYPE,
        entityId: customer.id,
        after: customer as unknown as Record<string, unknown>,
      });
      return customer;
    });
  }

  update(
    tenantId: string,
    actorUserId: string,
    id: string,
    dto: UpdateCustomerDto,
  ): Promise<CustomerRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.customers.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Customer not found');

      const after = await this.customers.updateWithClient(client, id, dto.version, {
        name: dto.name,
        contact: dto.contact && { ...dto.contact },
        creditLimit: dto.creditLimit,
        paymentTermsDays: dto.paymentTermsDays,
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

  archive(tenantId: string, actorUserId: string, id: string): Promise<CustomerRecord> {
    return this.setStatus(tenantId, actorUserId, id, 'archived', 'archive');
  }

  restore(tenantId: string, actorUserId: string, id: string): Promise<CustomerRecord> {
    return this.setStatus(tenantId, actorUserId, id, 'active', 'restore');
  }

  private setStatus(
    tenantId: string,
    actorUserId: string,
    id: string,
    status: 'active' | 'archived',
    action: 'archive' | 'restore',
  ): Promise<CustomerRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.customers.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Customer not found');

      const after = await this.customers.setStatusWithClient(client, id, status);
      if (!after) throw new NotFoundException('Customer not found');

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action,
        entityType: ENTITY_TYPE,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }
}
