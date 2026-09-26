import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { EmployeesRepository } from './repositories/employees.repository';
import { EmployeeRecord } from './entities/employee.entity';
import { PaginatedResult } from '../../common/persistence/pagination';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

const ENTITY_TYPE = 'employee';

@Injectable()
export class WorkforceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly employees: EmployeesRepository,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, page: number, pageSize: number): Promise<PaginatedResult<EmployeeRecord>> {
    return this.employees.list(tenantId, page, pageSize);
  }

  async getById(tenantId: string, id: string): Promise<EmployeeRecord> {
    const employee = await this.employees.findById(tenantId, id);
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  /** Called by Logistics to resolve which employee a logged-in driver actually is — null if this login has no linked employee record. */
  async getEmployeeIdForUser(tenantId: string, userId: string): Promise<string | null> {
    const employee = await this.employees.findByUserId(tenantId, userId);
    return employee?.id ?? null;
  }

  create(tenantId: string, actorUserId: string, dto: CreateEmployeeDto): Promise<EmployeeRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const employee = await this.employees.createWithClient(client, tenantId, actorUserId, {
        name: dto.name,
        roleType: dto.roleType,
        userId: dto.userId,
        employmentTerms: dto.employmentTerms ?? {},
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: ENTITY_TYPE,
        entityId: employee.id,
        after: employee as unknown as Record<string, unknown>,
      });
      return employee;
    });
  }

  update(
    tenantId: string,
    actorUserId: string,
    id: string,
    dto: UpdateEmployeeDto,
  ): Promise<EmployeeRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.employees.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Employee not found');

      const after = await this.employees.updateWithClient(client, id, dto.version, {
        name: dto.name,
        roleType: dto.roleType,
        employmentTerms: dto.employmentTerms,
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

  archive(tenantId: string, actorUserId: string, id: string): Promise<EmployeeRecord> {
    return this.setStatus(tenantId, actorUserId, id, 'archived', 'archive');
  }

  restore(tenantId: string, actorUserId: string, id: string): Promise<EmployeeRecord> {
    return this.setStatus(tenantId, actorUserId, id, 'active', 'restore');
  }

  private setStatus(
    tenantId: string,
    actorUserId: string,
    id: string,
    status: 'active' | 'archived',
    action: 'archive' | 'restore',
  ): Promise<EmployeeRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.employees.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Employee not found');

      const after = await this.employees.setStatusWithClient(client, id, status);
      if (!after) throw new NotFoundException('Employee not found');

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
