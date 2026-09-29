import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import {
  DocumentRecord,
  FleetSettings,
  FuelRecord,
  HireBill,
  HireContract,
  MaintenanceRecord,
} from '../entities/fleet.entity';

type Row = Record<string, unknown>;

const HIRE_CONTRACT_COLUMNS = `c.id, c.vehicle_id, c.owner_name, c.owner_pan, c.owner_phone, c.rate_basis, c.rate::text AS rate,
  c.includes_fuel, c.effective_from::text AS effective_from, c.effective_to::text AS effective_to`;

export const toContract = (r: Row): HireContract => ({
  id: r.id as string,
  vehicleId: r.vehicle_id as string,
  ownerName: r.owner_name as string,
  ownerPan: r.owner_pan as string | null,
  ownerPhone: r.owner_phone as string | null,
  rateBasis: r.rate_basis as HireContract['rateBasis'],
  rate: r.rate as string,
  includesFuel: r.includes_fuel as boolean,
  effectiveFrom: r.effective_from as string,
  effectiveTo: r.effective_to as string | null,
});

const BILL_SELECT = `
  SELECT b.id, b.vehicle_id, v.registration_number, b.contract_id, c.owner_name, b.period_start::text AS period_start,
         b.period_end::text AS period_end, b.quantity::text AS quantity, b.rate::text AS rate, b.amount::text AS amount,
         b.bill_reference, b.status, b.paid_on::text AS paid_on, b.paid_from, b.tds_amount::text AS tds_amount, b.tds_section, b.version
  FROM fleet.hire_bill b
  JOIN fleet.hire_contract c ON c.id = b.contract_id
  JOIN trading_partners.vehicle v ON v.id = b.vehicle_id`;

const toBill = (r: Row): HireBill => ({
  id: r.id as string,
  vehicleId: r.vehicle_id as string,
  registrationNumber: r.registration_number as string,
  contractId: r.contract_id as string,
  ownerName: r.owner_name as string,
  periodStart: r.period_start as string,
  periodEnd: r.period_end as string,
  quantity: r.quantity as string,
  rate: r.rate as string,
  amount: r.amount as string,
  billReference: r.bill_reference as string | null,
  status: r.status as HireBill['status'],
  paidOn: r.paid_on as string | null,
  paidFrom: r.paid_from as HireBill['paidFrom'],
  tdsAmount: r.tds_amount as string,
  tdsSection: r.tds_section as string | null,
  version: r.version as number,
});

/**
 * The fleet schema's own reads and writes, plus the vehicle record it
 * extends and — for trip counts and trip fuel — Logistics' trips, read
 * only (a reporting read model, System Architecture DB.4). RLS scopes
 * every statement; the client always comes from withTenant.
 */
@Injectable()
export class FleetRepository {
  async books(client: PoolClient): Promise<{ today: string; timezone: string; currency: string }> {
    const r = await client.query(
      `SELECT (now() AT TIME ZONE timezone)::date::text AS today, timezone, currency FROM tenant.tenant WHERE id = current_tenant_id()`,
    );
    return r.rows[0];
  }

  async instant(client: PoolClient, timezone: string, today: string, date: string): Promise<Date> {
    if (date >= today) return new Date();
    const r = await client.query<{ at: Date }>(`SELECT ($1::date + time '12:00')::timestamp AT TIME ZONE $2 AS at`, [date, timezone]);
    return r.rows[0].at;
  }

  // ---- Settings ----

  async settings(client: PoolClient): Promise<FleetSettings> {
    const r = await client.query('SELECT document_reminder_days, block_trips_on_expired, version FROM fleet.fleet_settings');
    const row = r.rows[0];
    return row
      ? { documentReminderDays: row.document_reminder_days, blockTripsOnExpired: row.block_trips_on_expired, version: row.version }
      : { documentReminderDays: 30, blockTripsOnExpired: true, version: 0 };
  }

  async saveSettings(client: PoolClient, tenantId: string, userId: string, version: number, s: Omit<FleetSettings, 'version'>): Promise<boolean> {
    if (version === 0) {
      const r = await client.query(
        `INSERT INTO fleet.fleet_settings (tenant_id, document_reminder_days, block_trips_on_expired, updated_by)
         VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId, s.documentReminderDays, s.blockTripsOnExpired, userId],
      );
      return (r.rowCount ?? 0) === 1;
    }
    const r = await client.query(
      `UPDATE fleet.fleet_settings SET document_reminder_days = $1, block_trips_on_expired = $2, updated_by = $3,
         version = version + 1, updated_at = now() WHERE version = $4`,
      [s.documentReminderDays, s.blockTripsOnExpired, userId, version],
    );
    return (r.rowCount ?? 0) === 1;
  }

  // ---- Vehicles ----

  async vehicles(client: PoolClient, vehicleId: string | null): Promise<Row[]> {
    const r = await client.query(
      `SELECT v.id AS vehicle_id, v.registration_number, v.status, v.fuel_type, v.capacity_kg::text AS capacity_kg,
              COALESCE(p.ownership, 'owned') AS ownership, p.make_model, p.manufacture_year, COALESCE(p.version, 0) AS profile_version,
              (SELECT max(o) FROM (SELECT odometer_km AS o FROM fleet.fuel_log f WHERE f.vehicle_id = v.id
                                   UNION ALL SELECT odometer_km FROM fleet.maintenance_record m WHERE m.vehicle_id = v.id) x) AS last_odometer
       FROM trading_partners.vehicle v LEFT JOIN fleet.vehicle_profile p ON p.vehicle_id = v.id
       WHERE $1::uuid IS NULL OR v.id = $1
       ORDER BY v.status = 'disposed', v.registration_number`,
      [vehicleId],
    );
    return r.rows;
  }

  async vehicleExists(client: PoolClient, id: string): Promise<{ registration_number: string; status: string; ownership: string } | null> {
    const r = await client.query(
      `SELECT v.registration_number, v.status, COALESCE(p.ownership, 'owned') AS ownership
       FROM trading_partners.vehicle v LEFT JOIN fleet.vehicle_profile p ON p.vehicle_id = v.id WHERE v.id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async saveProfile(
    client: PoolClient,
    tenantId: string,
    vehicleId: string,
    userId: string,
    version: number,
    p: { ownership: string; makeModel: string | null; manufactureYear: number | null },
  ): Promise<boolean> {
    if (version === 0) {
      const r = await client.query(
        `INSERT INTO fleet.vehicle_profile (vehicle_id, tenant_id, ownership, make_model, manufacture_year, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (vehicle_id) DO NOTHING`,
        [vehicleId, tenantId, p.ownership, p.makeModel, p.manufactureYear, userId],
      );
      return (r.rowCount ?? 0) === 1;
    }
    const r = await client.query(
      `UPDATE fleet.vehicle_profile SET ownership = $2, make_model = $3, manufacture_year = $4, updated_by = $5,
         version = version + 1, updated_at = now() WHERE vehicle_id = $1 AND version = $6`,
      [vehicleId, p.ownership, p.makeModel, p.manufactureYear, userId, version],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async setVehicleStatus(client: PoolClient, vehicleId: string, status: string): Promise<void> {
    await client.query(
      'UPDATE trading_partners.vehicle SET status = $2, version = version + 1, updated_at = now() WHERE id = $1',
      [vehicleId, status],
    );
  }

  async setAcquisition(client: PoolClient, vehicleId: string, cost: string, date: string): Promise<void> {
    await client.query(
      `UPDATE trading_partners.vehicle SET acquisition_cost = $2, acquisition_date = $3, version = version + 1, updated_at = now()
       WHERE id = $1`,
      [vehicleId, cost, date],
    );
  }

  // ---- Documents ----

  async documents(client: PoolClient, vehicleId: string | null): Promise<Row[]> {
    const r = await client.query(
      `SELECT d.id, d.vehicle_id, d.doc_type, d.doc_number, d.issuer, d.valid_from::text AS valid_from,
              d.valid_until::text AS valid_until, d.amount::text AS amount, d.notes, d.created_at,
              EXISTS (SELECT 1 FROM fleet.vehicle_document n WHERE n.vehicle_id = d.vehicle_id AND n.doc_type = d.doc_type
                        AND d.doc_type <> 'other'
                        AND (COALESCE(n.valid_until, 'infinity') > COALESCE(d.valid_until, 'infinity')
                             OR (COALESCE(n.valid_until, 'infinity') = COALESCE(d.valid_until, 'infinity') AND n.created_at > d.created_at))) AS superseded
       FROM fleet.vehicle_document d
       WHERE $1::uuid IS NULL OR d.vehicle_id = $1
       ORDER BY d.vehicle_id, d.doc_type, d.valid_until DESC NULLS FIRST, d.created_at DESC`,
      [vehicleId],
    );
    return r.rows;
  }

  async insertDocument(
    client: PoolClient,
    d: { id: string; tenantId: string; vehicleId: string; docType: string; docNumber: string | null; issuer: string | null; validFrom: string | null; validUntil: string | null; amount: string; paidFrom: string | null; notes: string | null; entryId: string | null; userId: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO fleet.vehicle_document
         (id, tenant_id, vehicle_id, doc_type, doc_number, issuer, valid_from, valid_until, amount, paid_from, notes, ledger_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [d.id, d.tenantId, d.vehicleId, d.docType, d.docNumber, d.issuer, d.validFrom, d.validUntil, d.amount, d.paidFrom, d.notes, d.entryId, d.userId],
    );
  }

  // ---- Fuel and maintenance ----

  async fuel(client: PoolClient, vehicleId: string | null, from: string | null, to: string | null): Promise<FuelRecord[]> {
    const r = await client.query(
      `SELECT id, vehicle_id, filled_on::text AS filled_on, litres::text AS litres, amount::text AS amount, odometer_km, station, paid_from, trip_id
       FROM fleet.fuel_log
       WHERE ($1::uuid IS NULL OR vehicle_id = $1) AND ($2::date IS NULL OR filled_on >= $2) AND ($3::date IS NULL OR filled_on <= $3)
       ORDER BY filled_on DESC, created_at DESC`,
      [vehicleId, from, to],
    );
    return r.rows.map((x) => ({
      id: x.id,
      vehicleId: x.vehicle_id,
      filledOn: x.filled_on,
      litres: x.litres,
      amount: x.amount,
      odometerKm: x.odometer_km,
      station: x.station,
      paidFrom: x.paid_from,
      tripId: x.trip_id,
    }));
  }

  async lastOdometer(client: PoolClient, vehicleId: string, onOrBefore: string): Promise<{ km: number; on: string } | null> {
    const r = await client.query(
      `SELECT odometer_km AS km, d::text AS on FROM (
         SELECT odometer_km, filled_on AS d FROM fleet.fuel_log WHERE vehicle_id = $1 AND odometer_km IS NOT NULL
         UNION ALL SELECT odometer_km, service_date FROM fleet.maintenance_record WHERE vehicle_id = $1 AND odometer_km IS NOT NULL) x
       WHERE d <= $2::date ORDER BY odometer_km DESC LIMIT 1`,
      [vehicleId, onOrBefore],
    );
    return r.rows[0] ?? null;
  }

  async insertFuel(
    client: PoolClient,
    f: { id: string; tenantId: string; vehicleId: string; filledOn: string; litres: string; amount: string; odometerKm: number | null; station: string | null; paidFrom: string; tripId: string | null; entryId: string; userId: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO fleet.fuel_log (id, tenant_id, vehicle_id, filled_on, litres, amount, odometer_km, station, paid_from, trip_id, ledger_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [f.id, f.tenantId, f.vehicleId, f.filledOn, f.litres, f.amount, f.odometerKm, f.station, f.paidFrom, f.tripId, f.entryId, f.userId],
    );
  }

  async tripVehicle(client: PoolClient, tripId: string): Promise<string | null> {
    const r = await client.query('SELECT vehicle_id FROM fulfilment.trip WHERE id = $1', [tripId]);
    return r.rows[0]?.vehicle_id ?? null;
  }

  async maintenance(client: PoolClient, vehicleId: string | null): Promise<MaintenanceRecord[]> {
    const r = await client.query(
      `SELECT id, vehicle_id, service_date::text AS service_date, kind, description, vendor, odometer_km, amount::text AS amount,
              next_due_date::text AS next_due_date, next_due_km
       FROM fleet.maintenance_record WHERE $1::uuid IS NULL OR vehicle_id = $1
       ORDER BY service_date DESC, created_at DESC`,
      [vehicleId],
    );
    return r.rows.map((x) => ({
      id: x.id,
      vehicleId: x.vehicle_id,
      serviceDate: x.service_date,
      kind: x.kind,
      description: x.description,
      vendor: x.vendor,
      odometerKm: x.odometer_km,
      amount: x.amount,
      nextDueDate: x.next_due_date,
      nextDueKm: x.next_due_km,
    }));
  }

  async insertMaintenance(
    client: PoolClient,
    m: { id: string; tenantId: string; vehicleId: string; serviceDate: string; kind: string; description: string; vendor: string | null; odometerKm: number | null; amount: string; paidFrom: string | null; nextDueDate: string | null; nextDueKm: number | null; entryId: string | null; userId: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO fleet.maintenance_record
         (id, tenant_id, vehicle_id, service_date, kind, description, vendor, odometer_km, amount, paid_from, next_due_date, next_due_km, ledger_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [m.id, m.tenantId, m.vehicleId, m.serviceDate, m.kind, m.description, m.vendor, m.odometerKm, m.amount, m.paidFrom, m.nextDueDate, m.nextDueKm, m.entryId, m.userId],
    );
  }

  // ---- Asset and depreciation ----

  async asset(client: PoolClient, vehicleId: string): Promise<Row | null> {
    const r = await client.query(
      `SELECT a.capitalized_on::text AS capitalized_on, a.cost::text AS cost, a.salvage_value::text AS salvage_value, a.method,
              a.useful_life_months, a.annual_rate::text AS annual_rate, a.funded_by, a.opening_accumulated::text AS opening_accumulated,
              (a.opening_accumulated + COALESCE((SELECT SUM(e.amount) FROM fleet.depreciation_entry e WHERE e.vehicle_id = a.vehicle_id), 0))::numeric(14,2)::text AS accumulated,
              (SELECT max(period_month)::text FROM fleet.depreciation_entry e WHERE e.vehicle_id = a.vehicle_id) AS depreciated_through
       FROM fleet.vehicle_asset a WHERE a.vehicle_id = $1`,
      [vehicleId],
    );
    return r.rows[0] ?? null;
  }

  async assets(client: PoolClient): Promise<Row[]> {
    const r = await client.query(
      `SELECT a.vehicle_id, v.registration_number, a.capitalized_on::text AS capitalized_on, a.cost::text AS cost,
              a.salvage_value::text AS salvage_value, a.method, a.useful_life_months, a.annual_rate::text AS annual_rate,
              (a.opening_accumulated + COALESCE((SELECT SUM(e.amount) FROM fleet.depreciation_entry e WHERE e.vehicle_id = a.vehicle_id), 0))::numeric(14,2)::text AS accumulated,
              (SELECT max(period_month)::text FROM fleet.depreciation_entry e WHERE e.vehicle_id = a.vehicle_id) AS depreciated_through,
              d.disposed_on::text AS disposed_on
       FROM fleet.vehicle_asset a
       JOIN trading_partners.vehicle v ON v.id = a.vehicle_id
       LEFT JOIN fleet.vehicle_disposal d ON d.vehicle_id = a.vehicle_id
       ORDER BY v.registration_number`,
    );
    return r.rows;
  }

  async depreciationEntries(client: PoolClient, vehicleId: string): Promise<Row[]> {
    const r = await client.query(
      `SELECT period_month::text AS month, amount::text AS amount, accumulated_after::text AS accumulated_after
       FROM fleet.depreciation_entry WHERE vehicle_id = $1 ORDER BY period_month DESC`,
      [vehicleId],
    );
    return r.rows;
  }

  async insertAsset(
    client: PoolClient,
    a: { vehicleId: string; tenantId: string; capitalizedOn: string; cost: string; salvageValue: string; method: string; usefulLifeMonths: number | null; annualRate: string | null; fundedBy: string; openingAccumulated: string; entryId: string; userId: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO fleet.vehicle_asset
         (vehicle_id, tenant_id, capitalized_on, cost, salvage_value, method, useful_life_months, annual_rate, funded_by, opening_accumulated, ledger_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [a.vehicleId, a.tenantId, a.capitalizedOn, a.cost, a.salvageValue, a.method, a.usefulLifeMonths, a.annualRate, a.fundedBy, a.openingAccumulated, a.entryId, a.userId],
    );
  }

  async lockDepreciation(client: PoolClient): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('fleet.depreciation:' || current_tenant_id()::text))`);
  }

  async insertRun(client: PoolClient, r: { id: string; tenantId: string; throughMonth: string; total: string; entryId: string | null; userId: string }): Promise<void> {
    await client.query(
      `INSERT INTO fleet.depreciation_run (id, tenant_id, through_month, total, ledger_entry_id, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [r.id, r.tenantId, r.throughMonth, r.total, r.entryId, r.userId],
    );
  }

  async insertDepreciation(client: PoolClient, tenantId: string, runId: string, vehicleId: string, month: string, amount: string, accumulatedAfter: string): Promise<void> {
    await client.query(
      `INSERT INTO fleet.depreciation_entry (tenant_id, vehicle_id, period_month, amount, accumulated_after, run_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, vehicleId, month, amount, accumulatedAfter, runId],
    );
  }

  async disposal(client: PoolClient, vehicleId: string): Promise<Row | null> {
    const r = await client.query(
      `SELECT disposed_on::text AS disposed_on, method, proceeds::text AS proceeds, net_book_value::text AS net_book_value,
              gain_loss_amount::text AS gain_loss, buyer FROM fleet.vehicle_disposal WHERE vehicle_id = $1`,
      [vehicleId],
    );
    return r.rows[0] ?? null;
  }

  async insertDisposal(
    client: PoolClient,
    d: { vehicleId: string; tenantId: string; disposedOn: string; method: string; proceeds: string; receivedInto: string | null; netBookValue: string; gainLoss: string; buyer: string | null; entryId: string; userId: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO fleet.vehicle_disposal
         (vehicle_id, tenant_id, disposed_on, method, proceeds, received_into, net_book_value, gain_loss_amount, buyer, ledger_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [d.vehicleId, d.tenantId, d.disposedOn, d.method, d.proceeds, d.receivedInto, d.netBookValue, d.gainLoss, d.buyer, d.entryId, d.userId],
    );
  }

  // ---- Loans ----

  async loans(client: PoolClient, vehicleId: string | null): Promise<Row[]> {
    const r = await client.query(
      `SELECT l.id, l.vehicle_id, l.lender, l.account_number, l.principal::text AS principal, l.annual_rate::text AS annual_rate,
              l.tenure_months, l.emi::text AS emi, l.disbursed_on::text AS disbursed_on, l.first_emi_on::text AS first_emi_on,
              l.status, l.version,
              COALESCE((SELECT SUM(p.principal) FROM fleet.loan_payment p WHERE p.loan_id = l.id), 0)::numeric(14,2)::text AS principal_repaid,
              COALESCE((SELECT SUM(p.interest) FROM fleet.loan_payment p WHERE p.loan_id = l.id), 0)::numeric(14,2)::text AS interest_paid,
              (SELECT count(*)::int FROM fleet.loan_payment p WHERE p.loan_id = l.id) AS installments_paid
       FROM fleet.vehicle_loan l WHERE $1::uuid IS NULL OR l.vehicle_id = $1
       ORDER BY l.disbursed_on DESC`,
      [vehicleId],
    );
    return r.rows;
  }

  async loanForUpdate(client: PoolClient, id: string): Promise<Row | null> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('fleet.loan'), hashtext($1))`, [id]);
    const rows = await this.loans(client, null);
    return rows.find((l) => l.id === id) ?? null;
  }

  async loanPayments(client: PoolClient, loanId: string): Promise<Row[]> {
    const r = await client.query(
      `SELECT installment_no, paid_on::text AS paid_on, interest::text AS interest, principal::text AS principal, paid_from, reference
       FROM fleet.loan_payment WHERE loan_id = $1 ORDER BY installment_no`,
      [loanId],
    );
    return r.rows;
  }

  async insertLoan(
    client: PoolClient,
    l: { id: string; tenantId: string; vehicleId: string; lender: string; accountNumber: string | null; principal: string; annualRate: string; tenureMonths: number; emi: string; disbursedOn: string; firstEmiOn: string; entryId: string; userId: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO fleet.vehicle_loan
         (id, tenant_id, vehicle_id, lender, account_number, principal, annual_rate, tenure_months, emi, disbursed_on, first_emi_on, disbursed_into, ledger_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'bank', $12, $13)`,
      [l.id, l.tenantId, l.vehicleId, l.lender, l.accountNumber, l.principal, l.annualRate, l.tenureMonths, l.emi, l.disbursedOn, l.firstEmiOn, l.entryId, l.userId],
    );
  }

  async insertLoanPayment(
    client: PoolClient,
    p: { id: string; tenantId: string; loanId: string; installmentNo: number; paidOn: string; interest: string; principal: string; paidFrom: string; reference: string | null; entryId: string; userId: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO fleet.loan_payment (id, tenant_id, loan_id, installment_no, paid_on, interest, principal, paid_from, reference, ledger_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [p.id, p.tenantId, p.loanId, p.installmentNo, p.paidOn, p.interest, p.principal, p.paidFrom, p.reference, p.entryId, p.userId],
    );
  }

  /** Every payment moves the version on (so a stale form can't pay twice); the last one closes the loan. */
  async touchLoan(client: PoolClient, id: string, close: boolean): Promise<void> {
    await client.query(
      `UPDATE fleet.vehicle_loan SET version = version + 1, status = CASE WHEN $2 THEN 'closed' ELSE status END WHERE id = $1`,
      [id, close],
    );
  }

  // ---- Hire ----

  async contracts(client: PoolClient, vehicleId: string | null): Promise<HireContract[]> {
    const r = await client.query(
      `SELECT ${HIRE_CONTRACT_COLUMNS} FROM fleet.hire_contract c WHERE $1::uuid IS NULL OR c.vehicle_id = $1 ORDER BY c.effective_from DESC`,
      [vehicleId],
    );
    return r.rows.map(toContract);
  }

  async insertContract(
    client: PoolClient,
    c: { tenantId: string; vehicleId: string; ownerName: string; ownerPan: string | null; ownerPhone: string | null; rateBasis: string; rate: string; includesFuel: boolean; effectiveFrom: string; userId: string },
  ): Promise<void> {
    await client.query(
      `UPDATE fleet.hire_contract SET effective_to = $2::date - 1
       WHERE vehicle_id = $1 AND effective_from < $2::date AND (effective_to IS NULL OR effective_to >= $2::date)`,
      [c.vehicleId, c.effectiveFrom],
    );
    await client.query(
      `INSERT INTO fleet.hire_contract (tenant_id, vehicle_id, owner_name, owner_pan, owner_phone, rate_basis, rate, includes_fuel, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [c.tenantId, c.vehicleId, c.ownerName, c.ownerPan, c.ownerPhone, c.rateBasis, c.rate, c.includesFuel, c.effectiveFrom, c.userId],
    );
  }

  async bills(client: PoolClient, vehicleId: string | null, status: string | null): Promise<HireBill[]> {
    const r = await client.query(
      `${BILL_SELECT} WHERE ($1::uuid IS NULL OR b.vehicle_id = $1) AND ($2::text IS NULL OR b.status = $2)
       ORDER BY b.period_end DESC, b.created_at DESC`,
      [vehicleId, status],
    );
    return r.rows.map(toBill);
  }

  async findBill(client: PoolClient, id: string): Promise<HireBill | null> {
    const r = await client.query(`${BILL_SELECT} WHERE b.id = $1`, [id]);
    return r.rows[0] ? toBill(r.rows[0]) : null;
  }

  async overlappingBill(client: PoolClient, vehicleId: string, from: string, to: string): Promise<{ period_start: string; period_end: string } | null> {
    const r = await client.query(
      `SELECT period_start::text, period_end::text FROM fleet.hire_bill
       WHERE vehicle_id = $1 AND period_start <= $3::date AND period_end >= $2::date LIMIT 1`,
      [vehicleId, from, to],
    );
    return r.rows[0] ?? null;
  }

  /** Completed trips on a vehicle in a period, and the distinct days they ran on (tenant-local). */
  async tripUse(client: PoolClient, vehicleId: string | null, from: string, to: string): Promise<{ vehicle_id: string; trips: number; days: number }[]> {
    const r = await client.query(
      `SELECT t.vehicle_id, count(*)::int AS trips,
              count(DISTINCT (COALESCE(t.started_at, t.completed_at) AT TIME ZONE tn.timezone)::date)::int AS days
       FROM fulfilment.trip t JOIN tenant.tenant tn ON tn.id = t.tenant_id
       WHERE t.status IN ('completed', 'reconciled') AND ($1::uuid IS NULL OR t.vehicle_id = $1)
         AND (COALESCE(t.started_at, t.completed_at) AT TIME ZONE tn.timezone)::date BETWEEN $2::date AND $3::date
       GROUP BY t.vehicle_id`,
      [vehicleId, from, to],
    );
    return r.rows;
  }

  async insertBill(
    client: PoolClient,
    b: { id: string; tenantId: string; vehicleId: string; contractId: string; from: string; to: string; quantity: string; rate: string; amount: string; billReference: string | null; entryId: string; userId: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO fleet.hire_bill
         (id, tenant_id, vehicle_id, contract_id, period_start, period_end, quantity, rate, amount, bill_reference, accrual_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [b.id, b.tenantId, b.vehicleId, b.contractId, b.from, b.to, b.quantity, b.rate, b.amount, b.billReference, b.entryId, b.userId],
    );
  }

  async markBillPaid(client: PoolClient, id: string, version: number, p: { paidOn: string; paidFrom: string; tdsAmount: string; tdsSection: string | null; entryId: string }): Promise<boolean> {
    const r = await client.query(
      `UPDATE fleet.hire_bill SET status = 'paid', paid_on = $3, paid_from = $4, tds_amount = $5, tds_section = $6,
         payment_entry_id = $7, version = version + 1
       WHERE id = $1 AND version = $2 AND status = 'unpaid'`,
      [id, version, p.paidOn, p.paidFrom, p.tdsAmount, p.tdsSection, p.entryId],
    );
    return (r.rowCount ?? 0) === 1;
  }

  // ---- Economics ----

  /** Every cost a vehicle ran up in a period, by kind, from its own records and its trips' fuel. */
  async costs(client: PoolClient, from: string, to: string): Promise<Row[]> {
    const r = await client.query(
      `WITH v AS (SELECT v.id, v.registration_number, COALESCE(p.ownership, 'owned') AS ownership
                  FROM trading_partners.vehicle v LEFT JOIN fleet.vehicle_profile p ON p.vehicle_id = v.id),
       tn AS (SELECT timezone FROM tenant.tenant WHERE id = current_tenant_id())
       SELECT v.id AS vehicle_id, v.registration_number, v.ownership,
         (SELECT COALESCE(SUM(amount), 0) FROM fleet.fuel_log f WHERE f.vehicle_id = v.id AND f.filled_on BETWEEN $1 AND $2)::numeric(14,2)::text AS fuel_logged,
         (SELECT COALESCE(SUM(litres), 0) FROM fleet.fuel_log f WHERE f.vehicle_id = v.id AND f.filled_on BETWEEN $1 AND $2)::numeric(12,3)::text AS litres,
         (SELECT COALESCE(SUM(e.amount), 0) FROM fulfilment.trip_expense e JOIN fulfilment.trip t ON t.id = e.trip_id, tn
            WHERE t.vehicle_id = v.id AND e.category = 'fuel' AND (e.recorded_at AT TIME ZONE tn.timezone)::date BETWEEN $1 AND $2)::numeric(14,2)::text AS fuel_on_trips,
         (SELECT COALESCE(SUM(amount), 0) FROM fleet.maintenance_record m WHERE m.vehicle_id = v.id AND m.service_date BETWEEN $1 AND $2)::numeric(14,2)::text AS maintenance,
         (SELECT COALESCE(SUM(amount), 0) FROM fleet.vehicle_document d WHERE d.vehicle_id = v.id AND (d.created_at AT TIME ZONE (SELECT timezone FROM tn))::date BETWEEN $1 AND $2)::numeric(14,2)::text AS documents,
         (SELECT COALESCE(SUM(amount), 0) FROM fleet.depreciation_entry e WHERE e.vehicle_id = v.id AND e.period_month BETWEEN date_trunc('month', $1::date)::date AND $2)::numeric(14,2)::text AS depreciation,
         (SELECT COALESCE(SUM(p.interest), 0) FROM fleet.loan_payment p JOIN fleet.vehicle_loan l ON l.id = p.loan_id WHERE l.vehicle_id = v.id AND p.paid_on BETWEEN $1 AND $2)::numeric(14,2)::text AS loan_interest,
         (SELECT COALESCE(SUM(amount), 0) FROM fleet.hire_bill b WHERE b.vehicle_id = v.id AND b.period_end BETWEEN $1 AND $2)::numeric(14,2)::text AS hire
       FROM v ORDER BY v.registration_number`,
      [from, to],
    );
    return r.rows;
  }

  static toDocument(r: Row, state: DocumentRecord['state']): DocumentRecord {
    return {
      id: r.id as string,
      vehicleId: r.vehicle_id as string,
      docType: r.doc_type as DocumentRecord['docType'],
      docNumber: r.doc_number as string | null,
      issuer: r.issuer as string | null,
      validFrom: r.valid_from as string | null,
      validUntil: r.valid_until as string | null,
      amount: r.amount as string,
      notes: r.notes as string | null,
      state,
      superseded: r.superseded as boolean,
      createdAt: r.created_at as Date,
    };
  }
}
