import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { AlertsRepository } from '../alerts/alerts.repository';
import { WorkforceService } from '../workforce/workforce.service';
import { PayrollService } from '../workforce/payroll.service';
import { CustomersService } from '../customers/customers.service';
import { CreateCustomerDto } from '../customers/dto/create-customer.dto';
import { UpdateCreditTermsDto } from '../customers/dto/update-credit-terms.dto';
import { PinsService } from '../logistics/pins.service';
import { compareMoney, moneyFromNumber } from '../../common/money';
import { DriverRequestsRepository } from './driver-requests.repository';
import { DriverRequest, DriverRequestKind } from './driver-requests.entity';
import { CreateDriverRequestDto, DecideDriverRequestDto } from './driver-requests.dto';

export interface RequestActor {
  tenantId: string;
  userId: string;
  permissions: string[];
}

/** Who may approve each kind: whoever may already do the thing it does. */
export const DECIDE_PERMISSION: Record<DriverRequestKind, string> = {
  advance: 'payroll:prepare',
  new_customer: 'customers:write',
  credit_limit: 'customers:credit',
};

const inr = (v: string | number) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** What's wrong with a request as sent, if anything — each kind carries its own fields and no others. */
export function requestProblemOf(dto: CreateDriverRequestDto): string | null {
  switch (dto.kind) {
    case 'advance':
      if (dto.amount === undefined || dto.amount <= 0) return 'Say how much the advance is for';
      if (dto.customerId || dto.customer) return 'An advance is for the driver, not a customer';
      return null;
    case 'credit_limit':
      if (!dto.customerId) return 'Say whose credit limit';
      if (dto.amount === undefined) return 'Say the limit to ask for';
      if (dto.customer) return 'A credit limit is for a customer already on the books';
      return null;
    case 'new_customer':
      if (!dto.customer) return "Say who the new customer is";
      if (dto.amount !== undefined || dto.customerId) return 'A new customer takes no amount';
      return null;
  }
}

function sameRequest(prior: DriverRequest, dto: CreateDriverRequestDto): boolean {
  return (
    prior.kind === dto.kind &&
    (prior.amount === null ? dto.amount === undefined : dto.amount !== undefined && compareMoney(prior.amount, moneyFromNumber(dto.amount)) === 0) &&
    (prior.customerId ?? null) === (dto.customerId ?? null)
  );
}

/**
 * What a driver asks the office for from the road (driver app D10) — an
 * advance, a new customer, a higher credit limit — and the owner's
 * decision on it in the Approvals inbox. Approving does the thing itself,
 * in the decision's transaction, through the module that owns it: the
 * advance through Payroll (recovered from the driver's pay, like any
 * advance), the customer through Customers (and its map pin), the limit
 * through Customers' credit terms. Refusing needs a reason; the driver reads
 * it on their Approvals screen.
 */
@Injectable()
export class DriverRequestsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: DriverRequestsRepository,
    private readonly workforce: WorkforceService,
    private readonly payroll: PayrollService,
    private readonly customers: CustomersService,
    private readonly pins: PinsService,
    private readonly alerts: AlertsRepository,
    private readonly audit: AuditService,
  ) {}

  private async driverOf(tenantId: string, userId: string): Promise<string> {
    const employeeId = await this.workforce.getEmployeeIdForUser(tenantId, userId);
    if (!employeeId) throw new ForbiddenException('Only a driver makes requests of their own');
    return employeeId;
  }

  async mine(tenantId: string, userId: string): Promise<DriverRequest[]> {
    const employeeId = await this.driverOf(tenantId, userId);
    return this.db.withTenant(tenantId, (client) => this.repo.listWithClient(client, { driverEmployeeId: employeeId, limit: 100 }));
  }

  /** Sent from a phone that may have been offline: with its own id, once however often it's sent. */
  async create(tenantId: string, userId: string, dto: CreateDriverRequestDto): Promise<DriverRequest> {
    const problem = requestProblemOf(dto);
    if (problem) throw new BadRequestException(problem);
    const employeeId = await this.driverOf(tenantId, userId);
    return this.db.withTenant(tenantId, async (client) => {
      if (dto.id) {
        const prior = await this.repo.findWithClient(client, dto.id);
        if (prior) {
          if (prior.driverEmployeeId === employeeId && sameRequest(prior, dto)) return prior;
          throw new ConflictException('That request was made already, differently');
        }
      }
      if (dto.tripId && !(await this.repo.driversTripWithClient(client, dto.tripId, employeeId))) throw new NotFoundException('Trip not found');
      let customerName: string | null = null;
      if (dto.customerId) {
        const customer = await this.repo.customerWithClient(client, dto.customerId);
        if (!customer || customer.status !== 'active') throw new NotFoundException('Customer not found');
        customerName = customer.name;
      }
      const c = dto.customer;
      const id = await this.repo.insertWithClient(client, {
        id: dto.id ?? null,
        tenantId,
        driverEmployeeId: employeeId,
        tripId: dto.tripId ?? null,
        kind: dto.kind,
        amount: dto.amount === undefined ? null : moneyFromNumber(dto.amount),
        customerId: dto.customerId ?? null,
        details: c
          ? {
              name: c.name.trim(),
              phone: c.phone?.trim() || null,
              place: c.place?.trim() || null,
              address: c.address?.trim() || null,
              language: c.language ?? null,
              latitude: c.latitude ?? null,
              longitude: c.longitude ?? null,
            }
          : {},
        reason: dto.reason.trim(),
        requestedBy: userId,
      });
      const request = (await this.repo.findWithClient(client, id)) as DriverRequest;
      await this.alerts.raiseWithClient(client, tenantId, {
        kind: 'driver_request',
        severity: 'warning',
        title:
          dto.kind === 'advance'
            ? `${request.driverName} asks for an advance of ${inr(request.amount!)}`
            : dto.kind === 'new_customer'
              ? `${request.driverName} met a new customer: ${c!.name.trim()}`
              : `${request.driverName} asks to raise ${customerName}'s credit limit to ${inr(request.amount!)}`,
        detail: `${request.reason} — decide under Approvals.`,
        tripId: request.tripId,
        dedupeKey: `driver_request:${id}`,
      });
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'driver_request', entityId: id, after: { ...dto } });
      return request;
    });
  }

  list(tenantId: string, status?: DriverRequest['status']): Promise<DriverRequest[]> {
    return this.db.withTenant(tenantId, (client) => this.repo.listWithClient(client, { status, limit: 200 }));
  }

  async get(tenantId: string, id: string): Promise<DriverRequest> {
    const request = await this.db.withTenant(tenantId, (client) => this.repo.findWithClient(client, id));
    if (!request) throw new NotFoundException('Request not found');
    return request;
  }

  decide(actor: RequestActor, id: string, dto: DecideDriverRequestDto): Promise<DriverRequest> {
    const { tenantId, userId } = actor;
    return this.db.withTenant(tenantId, async (client) => {
      if (!(await this.repo.lockWithClient(client, id))) throw new NotFoundException('Request not found');
      const request = (await this.repo.findWithClient(client, id)) as DriverRequest;
      if (request.status !== 'pending') throw new ConflictException(`This request was ${request.status} already`);
      const needed = DECIDE_PERMISSION[request.kind];
      if (!actor.permissions.includes(needed)) throw new ForbiddenException(`Deciding this needs the ${needed} permission`);
      const note = dto.note?.trim() || null;

      if (!dto.approve) {
        if (!note) throw new BadRequestException('Say why — the driver reads it');
        await this.repo.decideWithClient(client, id, { status: 'rejected', decidedBy: userId, note, resultRef: null });
        await this.audit.record(client, { tenantId, actorUserId: userId, action: 'update', entityType: 'driver_request', entityId: id, before: { status: 'pending' }, after: { status: 'rejected', note } });
        return (await this.repo.findWithClient(client, id)) as DriverRequest;
      }

      let resultRef: string;
      if (request.kind === 'advance') {
        const amount = dto.amount ?? Number(request.amount);
        if (amount <= 0) throw new BadRequestException('An advance is more than nothing');
        if (compareMoney(moneyFromNumber(amount), request.amount!) > 0) throw new BadRequestException(`The driver asked for ${inr(request.amount!)} — pay that or less`);
        resultRef = await this.payroll.recordAdvanceWithClient(client, tenantId, userId, {
          employeeId: request.driverEmployeeId,
          amount,
          paidOn: await this.repo.todayWithClient(client),
          paidFrom: dto.paidFrom ?? 'bank',
          notes: `Asked from the road: ${request.reason}`.slice(0, 300),
        });
      } else if (request.kind === 'new_customer') {
        const asked = request.newCustomer!;
        const c = dto.customer;
        const name = (c?.name ?? asked.name).trim();
        const phone = c ? c.phone?.trim() || null : asked.phone;
        const customer = await this.customers.createWithClient(client, tenantId, userId, {
          name,
          contact: phone ? { phone } : {},
          creditLimit: 0,
          paymentTermsDays: dto.paymentTermsDays ?? 0,
          preferredLanguage: (c ? c.language : asked.language) ?? undefined,
          place: c ? (c.place ?? null) : asked.place,
          address: c ? (c.address ?? null) : asked.address,
        } as CreateCustomerDto);
        const latitude = c?.latitude ?? asked.latitude;
        const longitude = c?.longitude ?? asked.longitude;
        if (latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined) {
          await this.pins.setWithClient(client, tenantId, userId, 'customer', customer.id, latitude, longitude);
        }
        resultRef = customer.id;
      } else {
        const customer = await this.repo.customerWithClient(client, request.customerId!);
        if (!customer) throw new NotFoundException('Customer not found');
        await this.customers.updateCreditTermsWithClient(client, tenantId, userId, request.customerId!, {
          version: customer.version,
          creditLimit: dto.amount ?? Number(request.amount),
          ...(dto.paymentTermsDays !== undefined && { paymentTermsDays: dto.paymentTermsDays }),
        } as UpdateCreditTermsDto);
        resultRef = request.customerId!;
      }
      await this.repo.decideWithClient(client, id, { status: 'approved', decidedBy: userId, note, resultRef });
      await this.audit.record(client, {
        tenantId,
        actorUserId: userId,
        action: 'update',
        entityType: 'driver_request',
        entityId: id,
        before: { status: 'pending' },
        after: { status: 'approved', note, resultRef, amount: dto.amount ?? null },
      });
      return (await this.repo.findWithClient(client, id)) as DriverRequest;
    });
  }
}
