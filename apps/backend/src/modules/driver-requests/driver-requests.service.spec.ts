import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DriverRequestsService, requestProblemOf } from './driver-requests.service';
import { DriverRequest } from './driver-requests.entity';

const base: DriverRequest = {
  id: 'r-1',
  kind: 'advance',
  status: 'pending',
  driverEmployeeId: 'emp-1',
  driverName: 'Raju',
  tripId: null,
  tripNumber: null,
  amount: '2000.00',
  customerId: null,
  customerName: null,
  currentCreditLimit: null,
  newCustomer: null,
  reason: 'Tyre puncture, need cash',
  requestedAt: new Date(),
  decidedAt: null,
  decidedBy: null,
  decisionNote: null,
  resultRef: null,
};

function setup(request: DriverRequest) {
  const client = {};
  const db = { withTenant: jest.fn((_t: string, work: (c: unknown) => unknown) => work(client)) };
  const repo = {
    lockWithClient: jest.fn().mockResolvedValue(true),
    findWithClient: jest.fn().mockResolvedValue(request),
    decideWithClient: jest.fn(),
    todayWithClient: jest.fn().mockResolvedValue('2026-10-31'),
    customerWithClient: jest.fn().mockResolvedValue({ name: 'Hotel Sagar', status: 'active', version: 4, paymentTermsDays: 7 }),
    insertWithClient: jest.fn().mockResolvedValue('r-1'),
    driversTripWithClient: jest.fn().mockResolvedValue(true),
  };
  const workforce = { getEmployeeIdForUser: jest.fn().mockResolvedValue('emp-1') };
  const payroll = { recordAdvanceWithClient: jest.fn().mockResolvedValue('adv-1') };
  const customers = { createWithClient: jest.fn().mockResolvedValue({ id: 'cust-new' }), updateCreditTermsWithClient: jest.fn() };
  const pins = { setWithClient: jest.fn() };
  const alerts = { raiseWithClient: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new DriverRequestsService(db as never, repo as never, workforce as never, payroll as never, customers as never, pins as never, alerts as never, audit as never);
  return { service, repo, payroll, customers, pins, alerts };
}

const owner = { tenantId: 't-1', userId: 'owner-1', permissions: ['payroll:prepare', 'customers:write', 'customers:credit'] };

describe('a driver request as sent', () => {
  it('carries its own fields and no others', () => {
    expect(requestProblemOf({ kind: 'advance', reason: 'diesel' })).toBe('Say how much the advance is for');
    expect(requestProblemOf({ kind: 'advance', amount: 500, reason: 'diesel' })).toBeNull();
    expect(requestProblemOf({ kind: 'advance', amount: 500, customerId: 'c', reason: 'x' })).not.toBeNull();
    expect(requestProblemOf({ kind: 'credit_limit', amount: 5000, reason: 'big order' })).toBe('Say whose credit limit');
    expect(requestProblemOf({ kind: 'credit_limit', customerId: 'c', amount: 5000, reason: 'big order' })).toBeNull();
    expect(requestProblemOf({ kind: 'new_customer', reason: 'new shop' })).toBe('Say who the new customer is');
    expect(requestProblemOf({ kind: 'new_customer', customer: { name: 'Sri Krishna Stores' }, reason: 'new shop' })).toBeNull();
  });
});

describe('creating one', () => {
  it('raises an alert for the owner with what was asked', async () => {
    const { service, alerts, repo } = setup(base);
    repo.findWithClient.mockResolvedValueOnce(null); // not sent before
    await service.create('t-1', 'driver-1', { id: '7c0e9d2a-0000-4000-8000-000000000001', kind: 'advance', amount: 2000, reason: 'Tyre puncture, need cash' });
    expect(repo.findWithClient).toHaveBeenCalled();
    expect(alerts.raiseWithClient).toHaveBeenCalledWith({}, 't-1', expect.objectContaining({ kind: 'driver_request', title: 'Raju asks for an advance of ₹2,000' }));
  });

  it('is the same request when sent again, and a conflict when sent differently', async () => {
    const { service, repo } = setup(base);
    await expect(service.create('t-1', 'driver-1', { id: 'r-1', kind: 'advance', amount: 2000, reason: 'again' })).resolves.toBe(base);
    expect(repo.insertWithClient).not.toHaveBeenCalled();
    await expect(service.create('t-1', 'driver-1', { id: 'r-1', kind: 'advance', amount: 3000, reason: 'again' })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('deciding one', () => {
  it('pays an approved advance through payroll, at most what was asked', async () => {
    const { service, payroll, repo } = setup(base);
    await service.decide(owner, 'r-1', { approve: true, amount: 1500 });
    expect(payroll.recordAdvanceWithClient).toHaveBeenCalledWith({}, 't-1', 'owner-1', expect.objectContaining({ employeeId: 'emp-1', amount: 1500, paidOn: '2026-10-31', paidFrom: 'bank' }));
    expect(repo.decideWithClient).toHaveBeenCalledWith({}, 'r-1', { status: 'approved', decidedBy: 'owner-1', note: null, resultRef: 'adv-1' });
    await expect(setup(base).service.decide(owner, 'r-1', { approve: true, amount: 2500 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates an approved new customer with its pin', async () => {
    const request: DriverRequest = { ...base, kind: 'new_customer', amount: null, newCustomer: { name: 'Sri Krishna Stores', phone: '9800000041', place: 'Kottayam', address: null, language: 'ml', latitude: 9.59, longitude: 76.52 } };
    const { service, customers, pins } = setup(request);
    await service.decide(owner, 'r-1', { approve: true, paymentTermsDays: 7 });
    expect(customers.createWithClient).toHaveBeenCalledWith({}, 't-1', 'owner-1', expect.objectContaining({ name: 'Sri Krishna Stores', contact: { phone: '9800000041' }, preferredLanguage: 'ml', place: 'Kottayam', paymentTermsDays: 7 }));
    expect(pins.setWithClient).toHaveBeenCalledWith({}, 't-1', 'owner-1', 'customer', 'cust-new', 9.59, 76.52);
  });

  it("sets an approved credit limit over the customer's current version", async () => {
    const request: DriverRequest = { ...base, kind: 'credit_limit', amount: '10000.00', customerId: 'cust-1', customerName: 'Hotel Sagar' };
    const { service, customers } = setup(request);
    await service.decide(owner, 'r-1', { approve: true });
    expect(customers.updateCreditTermsWithClient).toHaveBeenCalledWith({}, 't-1', 'owner-1', 'cust-1', { version: 4, creditLimit: 10000 });
  });

  it('needs a reason to refuse, the permission the thing needs, and a request still pending', async () => {
    await expect(setup(base).service.decide(owner, 'r-1', { approve: false })).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup(base).service.decide({ ...owner, permissions: ['customers:write'] }, 'r-1', { approve: true })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(setup({ ...base, status: 'approved' }).service.decide(owner, 'r-1', { approve: true })).rejects.toBeInstanceOf(ConflictException);
    const { service, repo, payroll } = setup(base);
    await service.decide(owner, 'r-1', { approve: false, note: 'Ask at the depot' });
    expect(payroll.recordAdvanceWithClient).not.toHaveBeenCalled();
    expect(repo.decideWithClient).toHaveBeenCalledWith({}, 'r-1', { status: 'rejected', decidedBy: 'owner-1', note: 'Ask at the depot', resultRef: null });
  });
});
