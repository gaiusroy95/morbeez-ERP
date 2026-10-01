import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { PriceBand, SpotSaleLine, SpotSaleRecord, SpotSettings } from '../entities/spot-sales.entity';

type Row = Record<string, unknown>;

const SALE_SELECT = `
  SELECT s.id, s.sale_number, s.client_ref, s.trip_id, s.vehicle_id, v.registration_number, s.driver_employee_id,
         e.name AS driver_name, s.buyer_name, s.buyer_phone, s.payment_method, s.payment_reference, s.status,
         s.subtotal::text AS subtotal, s.exception_value::text AS exception_value, s.tax_total::text AS tax_total,
         s.total::text AS total, s.cost_total::text AS cost_total, s.approval_request_id, r.status AS approval_status,
         COALESCE(ru.phone, ru.email::text) AS requested_by_email, r.decision_note, s.invoice_id, i.invoice_number, s.sold_at, s.completed_at,
         s.closed_reason, s.version, s.created_by
  FROM spot.spot_sale s
  JOIN trading_partners.vehicle v ON v.id = s.vehicle_id
  JOIN trading_partners.employee e ON e.id = s.driver_employee_id
  LEFT JOIN approvals.approval_request r ON r.id = s.approval_request_id
  LEFT JOIN identity.app_user ru ON ru.id = r.requested_by
  LEFT JOIN money.invoice i ON i.id = s.invoice_id`;

const toSale = (r: Row, lines: SpotSaleLine[]): SpotSaleRecord => {
  const revenue = r.total !== null && r.tax_total !== null ? Math.round((Number(r.total) - Number(r.tax_total)) * 100) : null;
  return {
    id: r.id as string,
    saleNumber: r.sale_number as string,
    clientRef: r.client_ref as string,
    tripId: r.trip_id as string,
    vehicleId: r.vehicle_id as string,
    registrationNumber: r.registration_number as string,
    driverEmployeeId: r.driver_employee_id as string,
    driverName: r.driver_name as string,
    buyerName: r.buyer_name as string | null,
    buyerPhone: r.buyer_phone as string | null,
    paymentMethod: r.payment_method as SpotSaleRecord['paymentMethod'],
    paymentReference: r.payment_reference as string | null,
    status: r.status as SpotSaleRecord['status'],
    subtotal: r.subtotal as string,
    exceptionValue: r.exception_value as string,
    taxTotal: r.tax_total as string | null,
    total: r.total as string | null,
    costTotal: r.cost_total as string | null,
    margin: revenue !== null && r.cost_total !== null ? ((revenue - Math.round(Number(r.cost_total) * 100)) / 100).toFixed(2) : null,
    approvalRequestId: r.approval_request_id as string | null,
    approvalStatus: r.approval_status as SpotSaleRecord['approvalStatus'],
    requestedByEmail: r.requested_by_email as string | null,
    decisionNote: r.decision_note as string | null,
    invoiceId: r.invoice_id as string | null,
    invoiceNumber: r.invoice_number as string | null,
    soldAt: r.sold_at as Date,
    completedAt: r.completed_at as Date | null,
    closedReason: r.closed_reason as string | null,
    version: r.version as number,
    lines,
  };
};

export interface SaleHeaderRow {
  id: string;
  sale_number: string;
  trip_id: string;
  vehicle_id: string;
  driver_employee_id: string;
  buyer_name: string | null;
  payment_method: 'cash' | 'upi';
  payment_reference: string | null;
  status: string;
  approval_request_id: string | null;
  sold_at: Date;
  created_by: string;
  version: number;
}

/**
 * The spot schema's reads and writes, plus what a sale touches elsewhere,
 * each in the caller's transaction: the vehicle's lots (commerce.lot, drawn
 * down), the stock movement ledger (stock.inventory_movement, 'spot_sold'),
 * and Logistics' trips (read only). RLS scopes every statement.
 */
@Injectable()
export class SpotSalesRepository {
  async books(client: PoolClient): Promise<{ today: string; timezone: string; currency: string }> {
    const r = await client.query(
      `SELECT (now() AT TIME ZONE timezone)::date::text AS today, timezone, currency FROM tenant.tenant WHERE id = current_tenant_id()`,
    );
    return r.rows[0];
  }

  /** Sales off one vehicle run one at a time: stock checked is stock drawn. */
  async lockVehicle(client: PoolClient, vehicleId: string): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('spot.vehicle'), hashtext($1))`, [vehicleId]);
  }

  // ---- Settings and bands ----

  async settings(client: PoolClient): Promise<SpotSettings> {
    const r = await client.query('SELECT default_floor_pct::text AS f, default_ceiling_pct::text AS c, version FROM spot.spot_settings');
    const row = r.rows[0];
    return row ? { defaultFloorPct: row.f, defaultCeilingPct: row.c, version: row.version } : { defaultFloorPct: '10.00', defaultCeilingPct: '25.00', version: 0 };
  }

  async saveSettings(client: PoolClient, tenantId: string, userId: string, version: number, s: { floor: string; ceiling: string }): Promise<boolean> {
    if (version === 0) {
      const r = await client.query(
        `INSERT INTO spot.spot_settings (tenant_id, default_floor_pct, default_ceiling_pct, updated_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId, s.floor, s.ceiling, userId],
      );
      return (r.rowCount ?? 0) === 1;
    }
    const r = await client.query(
      `UPDATE spot.spot_settings SET default_floor_pct = $1, default_ceiling_pct = $2, updated_by = $3, version = version + 1, updated_at = now()
       WHERE version = $4`,
      [s.floor, s.ceiling, userId, version],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async bands(client: PoolClient, productId: string | null): Promise<PriceBand[]> {
    const r = await client.query(
      `SELECT b.id, b.product_id, p.name AS product_name, b.min_price::text AS min_price, b.max_price::text AS max_price,
              b.effective_from::text AS effective_from, b.effective_to::text AS effective_to, b.notes
       FROM spot.price_band b JOIN trading_partners.product p ON p.id = b.product_id
       WHERE $1::uuid IS NULL OR b.product_id = $1
       ORDER BY p.name, b.effective_from DESC`,
      [productId],
    );
    return r.rows.map((b) => ({
      id: b.id,
      productId: b.product_id,
      productName: b.product_name,
      minPrice: b.min_price,
      maxPrice: b.max_price,
      effectiveFrom: b.effective_from,
      effectiveTo: b.effective_to,
      notes: b.notes,
    }));
  }

  /** The band in force on `date` for each product that has one. */
  async bandsInForce(client: PoolClient, productIds: string[], date: string): Promise<Map<string, { minPrice: string; maxPrice: string | null }>> {
    const r = await client.query(
      `SELECT DISTINCT ON (product_id) product_id, min_price::text AS min_price, max_price::text AS max_price
       FROM spot.price_band
       WHERE product_id = ANY($1::uuid[]) AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $2::date)
       ORDER BY product_id, effective_from DESC`,
      [productIds, date],
    );
    return new Map(r.rows.map((b) => [b.product_id as string, { minPrice: b.min_price as string, maxPrice: b.max_price as string | null }]));
  }

  /** Ends the band open on the new one's start, the day before; false if one already starts that day or later. */
  async endOpenBand(client: PoolClient, productId: string, from: string): Promise<boolean> {
    const later = await client.query('SELECT 1 FROM spot.price_band WHERE product_id = $1 AND effective_from >= $2::date', [productId, from]);
    if (later.rowCount) return false;
    await client.query(
      `UPDATE spot.price_band SET effective_to = $2::date - 1
       WHERE product_id = $1 AND effective_from < $2::date AND (effective_to IS NULL OR effective_to >= $2::date)`,
      [productId, from],
    );
    return true;
  }

  async insertBand(
    client: PoolClient,
    b: { tenantId: string; productId: string; minPrice: string; maxPrice: string | null; effectiveFrom: string; notes: string | null; userId: string },
  ): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO spot.price_band (tenant_id, product_id, min_price, max_price, effective_from, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [b.tenantId, b.productId, b.minPrice, b.maxPrice, b.effectiveFrom, b.notes, b.userId],
    );
    return r.rows[0].id;
  }

  async products(client: PoolClient, ids: string[]): Promise<Map<string, { name: string; uom: string; basePrice: string | null; status: string }>> {
    const r = await client.query(
      'SELECT id, name, base_uom, base_price::text AS base_price, status FROM trading_partners.product WHERE id = ANY($1::uuid[])',
      [ids],
    );
    return new Map(r.rows.map((p) => [p.id as string, { name: p.name, uom: p.base_uom, basePrice: p.base_price, status: p.status }]));
  }

  // ---- Trips and the vehicle's stock ----

  async trip(client: PoolClient, id: string): Promise<{ id: string; status: string; vehicle_id: string; driver_employee_id: string; registration_number: string } | null> {
    const r = await client.query(
      `SELECT t.id, t.status, t.vehicle_id, t.driver_employee_id, v.registration_number
       FROM fulfilment.trip t JOIN trading_partners.vehicle v ON v.id = t.vehicle_id WHERE t.id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  /** Available lots sitting at any of the vehicle's stock locations. */
  async vehicleLots(client: PoolClient, vehicleId: string): Promise<{ lot_id: string; product_id: string; quantity: string; unit_cost: string; received_at: string; location_id: string; version: number }[]> {
    const r = await client.query(
      `SELECT l.id AS lot_id, l.product_id, l.current_quantity::text AS quantity, l.unit_cost::text AS unit_cost,
              l.received_at::text AS received_at, l.current_location_id AS location_id, l.version
       FROM commerce.lot l JOIN stock.location loc ON loc.id = l.current_location_id
       WHERE loc.vehicle_id = $1 AND loc.type = 'vehicle' AND l.status = 'available' AND l.current_quantity > 0 AND l.unit_cost IS NOT NULL`,
      [vehicleId],
    );
    return r.rows;
  }

  /** Quantities held by this vehicle's sales awaiting approval, by product. */
  async held(client: PoolClient, vehicleId: string, exceptSaleId: string | null): Promise<Map<string, string>> {
    const r = await client.query(
      `SELECT l.product_id, SUM(l.quantity)::text AS held
       FROM spot.spot_sale_line l JOIN spot.spot_sale s ON s.id = l.sale_id
       WHERE s.vehicle_id = $1 AND s.status = 'pending_approval' AND ($2::uuid IS NULL OR s.id <> $2)
       GROUP BY l.product_id`,
      [vehicleId, exceptSaleId],
    );
    return new Map(r.rows.map((x) => [x.product_id as string, x.held as string]));
  }

  /** Draws a lot down; false if it no longer holds that much (moved or sold meanwhile). */
  async drawLot(client: PoolClient, lotId: string, quantity: string): Promise<boolean> {
    const r = await client.query(
      `UPDATE commerce.lot SET current_quantity = current_quantity - $2::numeric, version = version + 1, updated_at = now()
       WHERE id = $1 AND status = 'available' AND current_quantity >= $2::numeric`,
      [lotId, quantity],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async insertStockMovement(
    client: PoolClient,
    m: { tenantId: string; lotId: string; productId: string; quantity: string; locationId: string; reason: string; userId: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO stock.inventory_movement (tenant_id, lot_id, product_id, movement_type, quantity, reason, from_location_id, created_by)
       VALUES ($1, $2, $3, 'spot_sold', $4, $5, $6, $7)`,
      [m.tenantId, m.lotId, m.productId, m.quantity, m.reason, m.locationId, m.userId],
    );
  }

  // ---- Sales ----

  async nextSaleNumber(client: PoolClient): Promise<string> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('spot.number:' || current_tenant_id()::text))`);
    const r = await client.query<{ n: number }>('SELECT count(*)::int + 1 AS n FROM spot.spot_sale');
    return `SS-${String(r.rows[0].n).padStart(6, '0')}`;
  }

  async findByClientRef(client: PoolClient, clientRef: string): Promise<{ id: string; trip_id: string } | null> {
    const r = await client.query('SELECT id, trip_id FROM spot.spot_sale WHERE client_ref = $1', [clientRef]);
    return r.rows[0] ?? null;
  }

  async insertSale(
    client: PoolClient,
    s: {
      id: string;
      tenantId: string;
      saleNumber: string;
      clientRef: string;
      tripId: string;
      vehicleId: string;
      driverEmployeeId: string;
      buyerName: string | null;
      buyerPhone: string | null;
      paymentMethod: string;
      paymentReference: string | null;
      status: string;
      subtotal: string;
      exceptionValue: string;
      approvalRequestId: string | null;
      soldAt: Date;
      userId: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO spot.spot_sale (id, tenant_id, sale_number, client_ref, trip_id, vehicle_id, driver_employee_id, buyer_name, buyer_phone,
         payment_method, payment_reference, status, subtotal, exception_value, approval_request_id, sold_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [s.id, s.tenantId, s.saleNumber, s.clientRef, s.tripId, s.vehicleId, s.driverEmployeeId, s.buyerName, s.buyerPhone, s.paymentMethod, s.paymentReference, s.status, s.subtotal, s.exceptionValue, s.approvalRequestId, s.soldAt, s.userId],
    );
  }

  async insertLine(
    client: PoolClient,
    l: {
      tenantId: string;
      saleId: string;
      productId: string;
      quantity: string;
      unitPrice: string;
      amount: string;
      bandSource: string;
      bandMin: string | null;
      bandMax: string | null;
      unitCostEstimate: string | null;
      exception: string | null;
      exceptionValue: string;
    },
  ): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO spot.spot_sale_line (tenant_id, sale_id, product_id, quantity, unit_price, amount, band_source, band_min, band_max,
         unit_cost_estimate, exception, exception_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [l.tenantId, l.saleId, l.productId, l.quantity, l.unitPrice, l.amount, l.bandSource, l.bandMin, l.bandMax, l.unitCostEstimate, l.exception, l.exceptionValue],
    );
    return r.rows[0].id;
  }

  async insertLineLot(client: PoolClient, tenantId: string, lineId: string, lotId: string, quantity: string, unitCost: string): Promise<void> {
    await client.query('INSERT INTO spot.spot_sale_lot (tenant_id, line_id, lot_id, quantity, unit_cost) VALUES ($1, $2, $3, $4, $5)', [tenantId, lineId, lotId, quantity, unitCost]);
  }

  async header(client: PoolClient, id: string): Promise<SaleHeaderRow | null> {
    const r = await client.query(
      `SELECT id, sale_number, trip_id, vehicle_id, driver_employee_id, buyer_name, payment_method, payment_reference, status,
              approval_request_id, sold_at, created_by, version
       FROM spot.spot_sale WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async complete(client: PoolClient, id: string, f: { taxTotal: string; total: string; costTotal: string; invoiceId: string; paymentId: string }): Promise<void> {
    await client.query(
      `UPDATE spot.spot_sale SET status = 'completed', tax_total = $2, total = $3, cost_total = $4, invoice_id = $5, payment_id = $6,
         completed_at = now(), version = version + 1
       WHERE id = $1 AND status IN ('pending_approval', 'completed') AND invoice_id IS NULL`,
      [id, f.taxTotal, f.total, f.costTotal, f.invoiceId, f.paymentId],
    );
  }

  async close(client: PoolClient, id: string, status: 'rejected' | 'cancelled', reason: string): Promise<boolean> {
    const r = await client.query(
      `UPDATE spot.spot_sale SET status = $2, closed_reason = $3, version = version + 1 WHERE id = $1 AND status = 'pending_approval'`,
      [id, status, reason],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async lines(client: PoolClient, saleIds: string[]): Promise<Map<string, SpotSaleLine[]>> {
    const r = await client.query(
      `SELECT l.id, l.sale_id, l.product_id, p.name AS product_name, l.quantity::text AS quantity, l.unit_price::text AS unit_price,
              l.amount::text AS amount, l.band_source, l.band_min::text AS band_min, l.band_max::text AS band_max,
              l.unit_cost_estimate::text AS unit_cost_estimate, l.exception, l.exception_value::text AS exception_value,
              COALESCE((SELECT json_agg(json_build_object('lotId', x.lot_id, 'quantity', x.quantity::text, 'unitCost', x.unit_cost::text) ORDER BY x.id)
                        FROM spot.spot_sale_lot x WHERE x.line_id = l.id), '[]'::json) AS lots
       FROM spot.spot_sale_line l JOIN trading_partners.product p ON p.id = l.product_id
       WHERE l.sale_id = ANY($1::uuid[])
       ORDER BY p.name, l.id`,
      [saleIds],
    );
    const out = new Map<string, SpotSaleLine[]>();
    for (const l of r.rows) {
      out.set(l.sale_id, [
        ...(out.get(l.sale_id) ?? []),
        {
          id: l.id,
          productId: l.product_id,
          productName: l.product_name,
          quantity: l.quantity,
          unitPrice: l.unit_price,
          amount: l.amount,
          bandSource: l.band_source,
          bandMin: l.band_min,
          bandMax: l.band_max,
          unitCostEstimate: l.unit_cost_estimate,
          exception: l.exception,
          exceptionValue: l.exception_value,
          lots: l.lots,
        },
      ]);
    }
    return out;
  }

  async find(client: PoolClient, id: string): Promise<SpotSaleRecord | null> {
    const r = await client.query(`${SALE_SELECT} WHERE s.id = $1`, [id]);
    if (!r.rows[0]) return null;
    return toSale(r.rows[0], (await this.lines(client, [id])).get(id) ?? []);
  }

  async list(
    client: PoolClient,
    f: { timezone: string; from: string | null; to: string | null; status: string | null; tripId: string | null; driverEmployeeId: string | null; limit: number; offset: number },
  ): Promise<{ sales: SpotSaleRecord[]; total: number }> {
    const r = await client.query(
      `SELECT x.*, count(*) OVER () AS total_count FROM (${SALE_SELECT}
       WHERE ${SOLD_IN_RANGE}
         AND ($4::text IS NULL OR s.status = $4) AND ($5::uuid IS NULL OR s.trip_id = $5) AND ($6::uuid IS NULL OR s.driver_employee_id = $6)
       ) x
       ORDER BY x.sold_at DESC, x.sale_number DESC
       LIMIT $7 OFFSET $8`,
      [f.timezone, f.from, f.to, f.status, f.tripId, f.driverEmployeeId, f.limit, f.offset],
    );
    const lines = await this.lines(client, r.rows.map((x) => x.id as string));
    return { sales: r.rows.map((x) => toSale(x, lines.get(x.id as string) ?? [])), total: Number(r.rows[0]?.total_count ?? 0) };
  }

  /**
   * A period's totals, added up by the database over every sale in it —
   * never from the (capped) list, which once made a busy month's revenue
   * read ₹6.4 lakh instead of ₹84.5 lakh (Performance Audit PA-01).
   */
  async totals(client: PoolClient, f: { timezone: string; from: string; to: string }): Promise<{
    completed: number; pending: number; revenue: string; tax: string; cost: string; cash: string; upi: string; exceptions: number;
  }> {
    const r = await client.query(
      `SELECT count(*) FILTER (WHERE s.status = 'completed')::int AS completed,
              count(*) FILTER (WHERE s.status = 'pending_approval')::int AS pending,
              COALESCE(SUM(s.total - s.tax_total) FILTER (WHERE s.status = 'completed'), 0)::numeric(14,2)::text AS revenue,
              COALESCE(SUM(s.tax_total) FILTER (WHERE s.status = 'completed'), 0)::numeric(14,2)::text AS tax,
              COALESCE(SUM(s.cost_total) FILTER (WHERE s.status = 'completed'), 0)::numeric(14,2)::text AS cost,
              COALESCE(SUM(s.total) FILTER (WHERE s.status = 'completed' AND s.payment_method = 'cash'), 0)::numeric(14,2)::text AS cash,
              COALESCE(SUM(s.total) FILTER (WHERE s.status = 'completed' AND s.payment_method = 'upi'), 0)::numeric(14,2)::text AS upi,
              count(*) FILTER (WHERE s.status = 'completed' AND s.approval_request_id IS NOT NULL)::int AS exceptions
       FROM spot.spot_sale s
       WHERE ${SOLD_IN_RANGE}`,
      [f.timezone, f.from, f.to],
    );
    return r.rows[0];
  }
}

/**
 * Sold between two tenant-local dates, inclusive — written as a range on
 * sold_at itself so the (tenant_id, sold_at) index serves it; converting
 * each row's timestamp to a date first would scan every sale ($1 timezone,
 * $2 from, $3 to; either end may be null).
 */
const SOLD_IN_RANGE = `($2::date IS NULL OR s.sold_at >= ($2::date)::timestamp AT TIME ZONE $1)
         AND ($3::date IS NULL OR s.sold_at < ($3::date + 1)::timestamp AT TIME ZONE $1)`;
