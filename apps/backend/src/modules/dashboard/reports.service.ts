import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { FleetService } from '../vehicles/fleet.service';
import { PayrollService } from '../workforce/payroll.service';
import { formatPurchaseOrderNumber } from '../../common/persistence/document-number';
import { fromCents, toCents } from '../../common/money';
import { fromMilli, toMilli } from '../../common/quantity';
import { REPORT_ROW_LIMIT, ReportsRepository } from './repositories/reports.repository';
import { ReportCell, ReportColumn, ReportKind, ReportTable } from './entities/report.entity';

type Row = Record<string, ReportCell>;

interface Definition {
  title: string;
  /** What the caller must hold to see it. */
  permission: string;
  /** A master list: no dates. */
  list?: boolean;
  columns: ReportColumn[];
  /** Read inside the report's own transaction… */
  query?: (client: PoolClient, from: string, to: string) => Promise<Row[]>;
  /** …or from another module's service, which opens its own. */
  fetch?: (tenantId: string, from: string, to: string) => Promise<Row[]>;
}

const money = (key: string, label: string, total = true): ReportColumn => ({ key, label, kind: 'money', total });
const qty = (key: string, label: string, total = true): ReportColumn => ({ key, label, kind: 'qty', total });
const text = (key: string, label: string): ReportColumn => ({ key, label, kind: 'text' });

const STATUS: Record<string, string> = {
  planned: 'Planned',
  in_progress: 'On the road',
  completed: 'To close',
  on_hold: 'On hold',
  reconciled: 'Closed',
};

/**
 * Reports (owner app redesign Phase 7, screen 18): each one a table for a
 * date range — the books and the operations as they stand — that the owner
 * app shows, downloads as CSV and prints. Who may see a report is the same
 * permission as the screen its figures come from.
 */
@Injectable()
export class ReportsService {
  private readonly definitions: Record<ReportKind, Definition>;

  constructor(
    private readonly db: DatabaseService,
    private readonly reports: ReportsRepository,
    private readonly fleet: FleetService,
    private readonly payroll: PayrollService,
  ) {
    this.definitions = {
      sales: {
        title: 'Sales report',
        permission: 'finance:read',
        columns: [
          { key: 'date', label: 'Date', kind: 'date' },
          text('invoice', 'Invoice'),
          text('customer', 'Customer'),
          text('route', 'Route'),
          text('type', 'Type'),
          text('products', 'Products'),
          money('amount', 'Amount'),
          money('paid', 'Paid'),
          money('balance', 'Balance'),
        ],
        query: (c, from, to) => this.reports.sales(c, from, to),
      },
      procurement: {
        title: 'Procurement report',
        permission: 'procurement:read',
        columns: [
          { key: 'date', label: 'Date', kind: 'date' },
          text('po', 'PO'),
          text('farmer', 'Farmer'),
          text('product', 'Product'),
          qty('received', 'Received'),
          qty('accepted', 'Accepted'),
          text('uom', 'Unit'),
          money('rate', 'Rate', false),
          money('amount', 'Owed to the farmer'),
        ],
        query: async (c, from, to) =>
          (await this.reports.procurement(c, from, to)).map(({ po_number, ...r }) => ({ ...r, po: po_number === null ? null : formatPurchaseOrderNumber(Number(po_number)) })),
      },
      customers: {
        title: 'Customer profitability',
        permission: 'finance:read',
        columns: [
          text('customer', 'Customer'),
          text('place', 'Place'),
          money('sales', 'Sales'),
          money('cost', 'Cost of goods'),
          money('margin', 'Margin'),
          { key: 'margin_pct', label: 'Margin %', kind: 'pct' },
          money('collected', 'Collected'),
          money('outstanding', 'Owes now'),
        ],
        query: (c, from, to) => this.reports.customers(c, from, to),
      },
      products: {
        title: 'Product report',
        permission: 'dashboard:profit',
        columns: [
          text('product', 'Product'),
          qty('sold', 'Sold', false),
          text('uom', 'Unit'),
          money('sales', 'Sales'),
          money('cost', 'Cost of goods'),
          money('profit', 'Profit'),
          { key: 'margin_pct', label: 'Margin %', kind: 'pct' },
        ],
        query: (c, from, to) => this.reports.products(c, from, to),
      },
      farmers: {
        title: 'Farmer report',
        permission: 'finance:read',
        columns: [
          text('farmer', 'Farmer'),
          text('place', 'Place'),
          qty('kg', 'Kg bought'),
          money('purchases', 'Purchases'),
          money('paid', 'Paid'),
          money('outstanding', 'Owed now'),
        ],
        query: (c, from, to) => this.reports.farmers(c, from, to),
      },
      trips: {
        title: 'Trip / route report',
        permission: 'logistics:dispatch',
        columns: [
          text('trip', 'Trip'),
          { key: 'date', label: 'Date', kind: 'date' },
          text('route', 'Route'),
          text('driver', 'Driver'),
          text('vehicle', 'Vehicle'),
          text('status', 'Status'),
          { key: 'stops', label: 'Stops done', kind: 'text' },
          qty('km', 'KM'),
          money('delivered', 'Delivered'),
          money('collected', 'Collected'),
          money('expenses', 'Expenses'),
          money('backhaul', 'Backhaul'),
        ],
        query: async (c, from, to) =>
          (await this.reports.trips(c, from, to)).map(({ stops_done, stops, status, ...r }) => ({
            ...r,
            status: STATUS[String(status)] ?? status,
            stops: `${stops_done} of ${stops}`,
          })),
      },
      vehicles: {
        title: 'Vehicle report',
        permission: 'vehicles:read',
        columns: [
          text('vehicle', 'Vehicle'),
          text('ownership', 'Ownership'),
          { key: 'trips', label: 'Trips', kind: 'int', total: true },
          { key: 'km', label: 'KM', kind: 'int', total: true },
          qty('litres', 'Litres'),
          { key: 'km_per_litre', label: 'KM / litre', kind: 'text' },
          money('fuel', 'Fuel'),
          money('maintenance', 'Maintenance'),
          money('documents', 'Documents'),
          money('depreciation', 'Depreciation'),
          money('interest', 'Loan interest'),
          money('hire', 'Hire'),
          money('total', 'Total cost'),
          money('per_km', 'Cost / KM', false),
        ],
        fetch: async (tenantId, from, to) =>
          (await this.fleet.economics(tenantId, from, to)).rows.map((v) => ({
            vehicle: v.registrationNumber,
            ownership: v.ownership === 'hired' ? 'Hired' : 'Owned',
            trips: v.trips,
            km: v.km,
            litres: v.litres,
            km_per_litre: v.kmPerLitre,
            fuel: v.fuel,
            maintenance: v.maintenance,
            documents: v.documents,
            depreciation: v.depreciation,
            interest: v.loanInterest,
            hire: v.hire,
            total: v.total,
            per_km: v.costPerKm,
          })),
      },
      workforce: {
        title: 'Workforce report',
        permission: 'payroll:read',
        columns: [
          text('worker', 'Worker'),
          { key: 'days', label: 'Days worked', kind: 'int', total: true },
          money('wages', 'Wages'),
          money('incentives', 'Incentives'),
          money('gross', 'Gross'),
          money('deductions', 'Deductions'),
          money('net', 'Net pay'),
        ],
        fetch: async (tenantId, from, to) =>
          (await this.payroll.previewEarnings(tenantId, from, to)).map((w) => {
            const incentives = fromCents(w.lines.filter((l) => l.kind === 'incentive').reduce((n, l) => n + toCents(l.amount), 0n));
            return {
              worker: w.employeeName,
              days: w.daysWorked,
              wages: fromCents(toCents(w.gross) - toCents(incentives)),
              incentives,
              gross: w.gross,
              deductions: w.deductions,
              net: w.net,
            };
          }),
      },
      'customer-list': {
        title: 'Customers',
        permission: 'customers:read',
        list: true,
        columns: [text('name', 'Name'), text('place', 'Place'), text('phone', 'Phone'), { key: 'terms_days', label: 'Credit days', kind: 'int' }, money('credit_limit', 'Credit limit', false), text('status', 'Status')],
        query: (c) => this.reports.customerList(c),
      },
      'farmer-list': {
        title: 'Farmers',
        permission: 'farmers:read',
        list: true,
        columns: [text('name', 'Name'), text('place', 'Place'), text('phone', 'Phone'), text('status', 'Status')],
        query: (c) => this.reports.farmerList(c),
      },
      'product-list': {
        title: 'Products',
        permission: 'products:read',
        list: true,
        columns: [text('name', 'Name'), text('category', 'Category'), text('uom', 'Unit'), money('base_price', 'Base price', false), text('status', 'Status')],
        query: (c) => this.reports.productList(c),
      },
    };
  }

  async report(tenantId: string, permissions: string[], kind: string, from: string | undefined, to: string | undefined): Promise<ReportTable> {
    const def = this.definitions[kind as ReportKind];
    if (!def) throw new BadRequestException(`No such report: ${kind}`);
    if (!permissions.includes(def.permission)) throw new ForbiddenException(`Missing permission(s): ${def.permission}`);
    if (!def.list) {
      if (!from || !to) throw new BadRequestException('A report needs from and to dates');
      if (from > to) throw new BadRequestException('from must not be after to');
    }
    const start = from ?? '1970-01-01';
    const end = to ?? '1970-01-01';
    // Another module's report opens its own transaction: never inside ours.
    const all = def.fetch
      ? await def.fetch(tenantId, start, end)
      : await this.db.withTenant(tenantId, (client) => (def.query as NonNullable<Definition['query']>)(client, start, end));
    const truncated = all.length > REPORT_ROW_LIMIT;
    const rows = truncated ? all.slice(0, REPORT_ROW_LIMIT) : all;
    return {
      kind: kind as ReportKind,
      title: def.title,
      from: def.list ? null : start,
      to: def.list ? null : end,
      columns: def.columns,
      rows,
      totals: totalsOf(def.columns, rows),
      truncated,
    };
  }
}

/** The totals row: each totalled column added up exactly (money in paise, quantities in thousandths). */
export function totalsOf(columns: ReportColumn[], rows: Row[]): Row | null {
  const summed = columns.filter((c) => c.total);
  if (summed.length === 0 || rows.length === 0) return null;
  const totals: Row = {};
  for (const c of summed) {
    const values = rows.map((r) => r[c.key]).filter((v): v is string | number => v !== null && v !== undefined && v !== '');
    if (c.kind === 'money') totals[c.key] = fromCents(values.reduce<bigint>((n, v) => n + toCents(String(v)), 0n));
    else if (c.kind === 'qty') totals[c.key] = fromMilli(values.reduce<bigint>((n, v) => n + toMilli(String(v)), 0n));
    else totals[c.key] = values.reduce<number>((n, v) => n + Number(v), 0);
  }
  return totals;
}
