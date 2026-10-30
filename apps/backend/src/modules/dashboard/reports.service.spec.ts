import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { ReportsService, totalsOf } from './reports.service';

describe('report totals', () => {
  it('add up money in paise, quantities in thousandths and counts, only for totalled columns', () => {
    const totals = totalsOf(
      [
        { key: 'name', label: 'Name', kind: 'text' },
        { key: 'amount', label: 'Amount', kind: 'money', total: true },
        { key: 'kg', label: 'Kg', kind: 'qty', total: true },
        { key: 'trips', label: 'Trips', kind: 'int', total: true },
        { key: 'rate', label: 'Rate', kind: 'money', total: false },
      ],
      [
        { name: 'A', amount: '0.10', kg: '0.333', trips: 2, rate: '48.00' },
        { name: 'B', amount: '0.20', kg: '0.667', trips: 1, rate: '50.00' },
        { name: 'C', amount: null, kg: '1.000', trips: 0, rate: null },
      ],
    );
    expect(totals).toEqual({ amount: '0.30', kg: '2.000', trips: 3 });
  });

  it('are left out when nothing is totalled or there are no rows', () => {
    expect(totalsOf([{ key: 'name', label: 'Name', kind: 'text' }], [{ name: 'A' }])).toBeNull();
    expect(totalsOf([{ key: 'amount', label: 'Amount', kind: 'money', total: true }], [])).toBeNull();
  });
});

describe('ReportsService', () => {
  const repo = { sales: jest.fn().mockResolvedValue([{ date: '2026-10-29', invoice: 'INV-000001', amount: '600.00', paid: '600.00', balance: '0.00' }]) };
  const db = { withTenant: jest.fn((_t: string, work: (c: unknown) => unknown) => work({})) };
  const service = new ReportsService(db as never, repo as never, {} as never, {} as never);

  it('needs the permission of the screen its figures come from', async () => {
    await expect(service.report('t', ['logistics:read'], 'sales', '2026-10-01', '2026-10-31')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('needs dates, in order, and a known report', async () => {
    await expect(service.report('t', ['finance:read'], 'sales', undefined, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.report('t', ['finance:read'], 'sales', '2026-10-31', '2026-10-01')).rejects.toThrow('from must not be after to');
    await expect(service.report('t', ['finance:read'], 'nonsense', '2026-10-01', '2026-10-31')).rejects.toThrow('No such report');
  });

  it('returns the rows with the totals row', async () => {
    const table = await service.report('t', ['finance:read'], 'sales', '2026-10-01', '2026-10-31');
    expect(table.title).toBe('Sales report');
    expect(table.rows).toHaveLength(1);
    expect(table.totals).toEqual({ amount: '600.00', paid: '600.00', balance: '0.00' });
    expect(table.truncated).toBe(false);
  });
});
