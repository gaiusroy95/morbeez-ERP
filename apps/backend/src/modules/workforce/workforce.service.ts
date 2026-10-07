import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { EmployeesRepository } from './repositories/employees.repository';
import { EmployeeRecord } from './entities/employee.entity';
import { PaginatedResult } from '../../common/persistence/pagination';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

const ENTITY_TYPE = 'employee';
export const NEW_DRIVER_LEVEL = 2;

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
        // A new driver delivers and collects, on every trip they drive
        // (delegation level 2, standing). Procurement and running the whole
        // route are the owner's call (client Q&A, D: Q15).
        ...(dto.roleType === 'driver' ? { delegationLevel: NEW_DRIVER_LEVEL, standingDelegation: true } : {}),
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

  /** The owner sets who may be delegated to, up to which level, and whether that stands for every trip. */
  setDelegation(
    tenantId: string,
    actorUserId: string,
    id: string,
    fields: { delegationLevel: number | null; standingDelegation: boolean },
  ): Promise<EmployeeRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.employees.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Employee not found');
      if (before.roleType !== 'driver') throw new BadRequestException('Only drivers take delegated trips');
      const after = await this.employees.setDelegationWithClient(client, id, {
        delegationLevel: fields.delegationLevel,
        // A standing permission needs a level to stand at.
        standingDelegation: fields.delegationLevel !== null && fields.standingDelegation,
      });
      if (!after) throw new NotFoundException('Employee not found');
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: ENTITY_TYPE,
        entityId: id,
        before: { delegationLevel: before.delegationLevel, standingDelegation: before.standingDelegation },
        after: { delegationLevel: after.delegationLevel, standingDelegation: after.standingDelegation },
      });
      return after;
    });
  }

  /**
   * The owner-driver: the signed-in person drives too. Gives their own login
   * a driver record (full route operator, standing — it's their business),
   * or returns the one it already has, so trips can be assigned to them and
   * the Driver app shows their route.
   */
  driveMyself(tenantId: string, actorUserId: string, name: string): Promise<EmployeeRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const existing = await client.query<{ id: string }>('SELECT id FROM trading_partners.employee WHERE user_id = $1', [actorUserId]);
      if (existing.rows[0]) {
        const current = await this.employees.findByIdWithClient(client, existing.rows[0].id);
        if (current!.roleType !== 'driver') {
          throw new ConflictException(`Your login is already linked to ${current!.name} (${current!.roleType}), who isn't a driver`);
        }
        return current!;
      }
      const employee = await this.employees.createWithClient(client, tenantId, actorUserId, {
        name,
        roleType: 'driver',
        userId: actorUserId,
        employmentTerms: {},
        delegationLevel: 4,
        standingDelegation: true,
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
