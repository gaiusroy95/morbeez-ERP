import { customerScore, isCreditRisk, onTimePct } from './customer-insights';

describe('customer score', () => {
  it('is 5 × the share of invoices paid on time', () => {
    expect(customerScore({ settled: 10, onTime: 9, oldestOverdueDays: null, creditHold: false })).toBe(4.5);
    expect(onTimePct({ settled: 10, onTime: 9 })).toBe(90);
  });

  it('loses a point for every 15 days (or part) the oldest invoice is overdue, at most 4', () => {
    expect(customerScore({ settled: 4, onTime: 4, oldestOverdueDays: 1, creditHold: false })).toBe(4);
    expect(customerScore({ settled: 4, onTime: 4, oldestOverdueDays: 16, creditHold: false })).toBe(3);
    expect(customerScore({ settled: 4, onTime: 4, oldestOverdueDays: 200, creditHold: false })).toBe(1);
    expect(customerScore({ settled: 2, onTime: 0, oldestOverdueDays: 45, creditHold: false })).toBe(0);
  });

  it('stays at 1 or below on credit hold', () => {
    expect(customerScore({ settled: 5, onTime: 5, oldestOverdueDays: null, creditHold: true })).toBe(1);
  });

  it('is blank for a customer with no payment history', () => {
    expect(customerScore({ settled: 0, onTime: 0, oldestOverdueDays: null, creditHold: false })).toBeNull();
    expect(onTimePct({ settled: 0, onTime: 0 })).toBeNull();
  });
});

describe('credit risk', () => {
  const base = { creditHold: false, oldestOverdueDays: null, creditLimit: 100000, outstanding: 0, onAccount: 0, openOrders: 0 };

  it('flags a hold, an invoice over 30 days overdue, or 90% of the limit in use', () => {
    expect(isCreditRisk({ ...base, creditHold: true })).toBe(true);
    expect(isCreditRisk({ ...base, oldestOverdueDays: 31 })).toBe(true);
    expect(isCreditRisk({ ...base, oldestOverdueDays: 30 })).toBe(false);
    expect(isCreditRisk({ ...base, outstanding: 60000, openOrders: 30000 })).toBe(true);
    expect(isCreditRisk({ ...base, outstanding: 60000, onAccount: 10000, openOrders: 30000 })).toBe(false);
  });

  it('a cash-only customer (no limit) is not at risk for using credit', () => {
    expect(isCreditRisk({ ...base, creditLimit: 0, outstanding: 500 })).toBe(false);
  });
});
