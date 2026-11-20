/* eslint-disable camelcase */

// Master Spec v3 P5 — cost allocation and true cost (docs/redesign/master-spec-v3-plan.md,
// rules C1–C8; Master Spec §34–36; the 12 fixes 7–8; decision D1, answered 10 Nov 2026).
//
// 1. money.trip_cost — a closed trip's cost, worked out once at the close and
//    never changed (Cost Allocation Engine: "allocation is not posting" — the
//    costs are already in the ledger; this only shares them out). Two pools:
//    running (fuel, tolls and parking, road repairs, the driver's incentives,
//    other expenses, the vehicle's share by km) and load (loading labour,
//    helpers' incentives, stock written off on the trip). Driver base pay is
//    never in it (MS §34). The trip's delivery cost per KG against the
//    standard — the rolling 30 days before it — and the variance (FX 7).
// 2. money.trip_cost_allocation — every rupee of it, once: per order line
//    delivered (or lot picked up), per component. Allocated + unallocated =
//    the trip's cost, to the paisa (enforced here, not only in the code).
// 3. money.cost_allocation_setting — the running pool's share by KG (the rest
//    by verified service minutes), dated; 50% until the owner changes it.
// 4. trading_partners.product.unit_weight_kg — what one unit weighs, for
//    products not sold by weight (eggs, crates), so they carry their KG share.

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const userColumn = { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };
const money = () => ({ type: 'numeric(12,2)', notNull: true, default: 0 });
const RUNNING = ['fuel', 'tolls', 'repairs', 'driver_incentives', 'other_expenses', 'vehicle'];
const LOAD = ['labour', 'helper_incentives', 'written_off'];
const COMPONENTS = [...RUNNING, ...LOAD];
const components = () => Object.fromEntries(COMPONENTS.map((c) => [c, money()]));

/** RLS like every tenant table, insert-only for the app; a trigger takes the parent's tenant and refuses a foreign parent. */
function isolate(pgm, table, parent, parentCol) {
  if (parent) {
    pgm.sql(`
      CREATE TRIGGER ${table}_tenant BEFORE INSERT OR UPDATE OF tenant_id, ${parentCol} ON money.${table}
        FOR EACH ROW EXECUTE FUNCTION tenant.inherit_tenant_id('${parent}', '${parentCol}')
    `);
  }
  pgm.sql(`ALTER TABLE money.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE money.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON money.${table} USING (tenant_id = current_tenant_id())`);
  pgm.sql(`REVOKE UPDATE, DELETE ON money.${table} FROM morbeez_app`);
}

exports.up = (pgm) => {
  // ---- 1. The trip's cost ----
  pgm.createTable({ schema: 'money', name: 'trip_cost' }, {
    trip_id: { type: 'uuid', primaryKey: true, references: { schema: 'fulfilment', name: 'trip' }, onDelete: 'RESTRICT' },
    tenant_id: tenantColumn,
    // 'close': worked out as the trip closed; 'backfill': a trip closed before costing, costed on request.
    source: { type: 'text', notNull: true },
    computed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    computed_by: { ...userColumn, notNull: true },
    // The running pool's share by KG in force (the rest by verified service minutes).
    kg_share_pct: { type: 'numeric(5,2)', notNull: true },
    ...components(),
    running_total: money(),
    load_total: money(),
    total: money(),
    // The vehicle's share: the trip's km × the vehicle's cost per km over the 30 days before the close.
    trip_km: { type: 'numeric(10,1)' },
    vehicle_rate_per_km: { type: 'numeric(12,4)' },
    delivered_kg: { type: 'numeric(14,3)', notNull: true, default: 0 },
    pickup_kg: { type: 'numeric(14,3)', notNull: true, default: 0 },
    // Where it went: order lines delivered, lots picked up (the inbound leg), or nowhere (with why).
    delivery_cost: money(),
    inbound_cost: money(),
    unallocated: money(),
    unallocated_reason: { type: 'text' },
    // Lines whose product has no weight: no KG share (rule C4).
    unweighted_lines: { type: 'integer', notNull: true, default: 0 },
    // FX 7: this trip's delivery cost per KG, the standard it's held to, and the gap.
    actual_per_kg: { type: 'numeric(12,4)' },
    standard_per_kg: { type: 'numeric(12,4)' },
    standard_basis: { type: 'text' },
    standard_trips: { type: 'integer', notNull: true, default: 0 },
    variance_per_kg: { type: 'numeric(12,4)' },
  });
  pgm.addConstraint({ schema: 'money', name: 'trip_cost' }, 'trip_cost_adds_up', {
    check: `source IN ('close', 'backfill')
      AND kg_share_pct BETWEEN 0 AND 100
      AND ${COMPONENTS.map((c) => `${c} >= 0`).join(' AND ')}
      AND running_total = ${RUNNING.join(' + ')}
      AND load_total = ${LOAD.join(' + ')}
      AND total = running_total + load_total
      AND delivery_cost >= 0 AND inbound_cost >= 0 AND unallocated >= 0
      AND total = delivery_cost + inbound_cost + unallocated
      AND (unallocated = 0) = (unallocated_reason IS NULL)
      AND delivered_kg >= 0 AND pickup_kg >= 0 AND unweighted_lines >= 0 AND standard_trips >= 0
      AND (standard_basis IS NULL OR standard_basis IN ('route', 'business'))
      AND (standard_basis IS NULL) = (standard_per_kg IS NULL)
      AND (variance_per_kg IS NULL OR (actual_per_kg IS NOT NULL AND standard_per_kg IS NOT NULL))`,
  });
  pgm.createIndex({ schema: 'money', name: 'trip_cost' }, ['tenant_id', 'computed_at']);
  isolate(pgm, 'trip_cost', 'fulfilment.trip', 'trip_id');

  // ---- 2. Where every rupee went ----
  pgm.createTable({ schema: 'money', name: 'trip_cost_allocation' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    trip_id: { type: 'uuid', notNull: true, references: { schema: 'money', name: 'trip_cost' }, onDelete: 'RESTRICT' },
    trip_stop_id: { type: 'uuid', notNull: true, references: { schema: 'fulfilment', name: 'trip_stop' }, onDelete: 'RESTRICT' },
    // An order line delivered, or a lot picked up (the inbound leg) — one or the other.
    order_line_id: { type: 'uuid', references: { schema: 'commerce', name: 'customer_order_line' }, onDelete: 'RESTRICT' },
    lot_id: { type: 'uuid', references: { schema: 'commerce', name: 'lot' }, onDelete: 'RESTRICT' },
    customer_id: { type: 'uuid', references: { schema: 'trading_partners', name: 'customer' }, onDelete: 'RESTRICT' },
    product_id: { type: 'uuid', notNull: true, references: { schema: 'trading_partners', name: 'product' }, onDelete: 'RESTRICT' },
    kg: { type: 'numeric(14,3)', notNull: true, default: 0 },
    service_minutes: { type: 'integer' },
    ...components(),
    amount: money(),
  });
  pgm.addConstraint({ schema: 'money', name: 'trip_cost_allocation' }, 'trip_cost_allocation_valid', {
    check: `(order_line_id IS NULL) <> (lot_id IS NULL)
      AND (order_line_id IS NULL OR customer_id IS NOT NULL)
      AND kg >= 0 AND (service_minutes IS NULL OR service_minutes >= 0)
      AND ${COMPONENTS.map((c) => `${c} >= 0`).join(' AND ')}
      AND amount = ${COMPONENTS.join(' + ')}`,
  });
  pgm.sql('CREATE UNIQUE INDEX trip_cost_allocation_line_once ON money.trip_cost_allocation (trip_id, order_line_id) WHERE order_line_id IS NOT NULL');
  pgm.sql('CREATE UNIQUE INDEX trip_cost_allocation_lot_once ON money.trip_cost_allocation (trip_id, lot_id) WHERE lot_id IS NOT NULL');
  for (const col of ['trip_id', 'trip_stop_id', 'order_line_id', 'lot_id', 'customer_id', 'product_id']) {
    pgm.createIndex({ schema: 'money', name: 'trip_cost_allocation' }, ['tenant_id', col]);
  }
  isolate(pgm, 'trip_cost_allocation', 'fulfilment.trip', 'trip_id');

  // Every rupee once, checked by the database at COMMIT: a trip's allocations
  // add up, component by component, to its cost less what stayed unallocated.
  pgm.sql(`
    CREATE FUNCTION money.assert_trip_cost_allocated() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      c money.trip_cost%ROWTYPE;
      a record;
    BEGIN
      SELECT * INTO c FROM money.trip_cost WHERE trip_id = NEW.trip_id;
      SELECT ${COMPONENTS.map((x) => `COALESCE(SUM(${x}), 0) AS ${x}`).join(', ')},
             COALESCE(SUM(amount) FILTER (WHERE order_line_id IS NOT NULL), 0) AS delivery,
             COALESCE(SUM(amount) FILTER (WHERE lot_id IS NOT NULL), 0) AS inbound
        INTO a FROM money.trip_cost_allocation WHERE trip_id = NEW.trip_id;
      IF a.delivery <> c.delivery_cost OR a.inbound <> c.inbound_cost THEN
        RAISE EXCEPTION 'Trip % cost: allocated % to deliveries and % inbound, recorded % and %', NEW.trip_id, a.delivery, a.inbound, c.delivery_cost, c.inbound_cost
          USING ERRCODE = 'check_violation';
      END IF;
      IF ${COMPONENTS.map((x) => `a.${x} > c.${x}`).join(' OR ')} THEN
        RAISE EXCEPTION 'Trip % cost: a component is allocated beyond its cost', NEW.trip_id USING ERRCODE = 'check_violation';
      END IF;
      RETURN NULL;
    END;
    $$
  `);
  pgm.sql(`
    CREATE CONSTRAINT TRIGGER trip_cost_allocated
      AFTER INSERT ON money.trip_cost DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION money.assert_trip_cost_allocated()
  `);
  pgm.sql(`
    CREATE CONSTRAINT TRIGGER trip_cost_allocation_adds_up
      AFTER INSERT ON money.trip_cost_allocation DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION money.assert_trip_cost_allocated()
  `);
  pgm.sql('GRANT EXECUTE ON FUNCTION money.assert_trip_cost_allocated() TO morbeez_app');

  // ---- 3. How the running pool is shared (D1) ----
  pgm.createTable({ schema: 'money', name: 'cost_allocation_setting' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    kg_share_pct: { type: 'numeric(5,2)', notNull: true },
    effective_from: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    set_by: { ...userColumn, notNull: true },
    note: { type: 'text' },
  });
  pgm.addConstraint({ schema: 'money', name: 'cost_allocation_setting' }, 'cost_allocation_setting_valid', { check: 'kg_share_pct BETWEEN 0 AND 100' });
  pgm.createIndex({ schema: 'money', name: 'cost_allocation_setting' }, ['tenant_id', 'effective_from']);
  isolate(pgm, 'cost_allocation_setting', null, null);

  // ---- 4. Weight per unit ----
  pgm.addColumns({ schema: 'trading_partners', name: 'product' }, { unit_weight_kg: { type: 'numeric(10,4)' } });
  pgm.addConstraint({ schema: 'trading_partners', name: 'product' }, 'product_unit_weight_valid', {
    check: "unit_weight_kg IS NULL OR (unit_weight_kg > 0 AND base_uom NOT IN ('kg', 'g'))",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint({ schema: 'trading_partners', name: 'product' }, 'product_unit_weight_valid');
  pgm.dropColumns({ schema: 'trading_partners', name: 'product' }, ['unit_weight_kg']);
  pgm.dropTable({ schema: 'money', name: 'cost_allocation_setting' });
  pgm.dropTable({ schema: 'money', name: 'trip_cost_allocation' });
  pgm.dropTable({ schema: 'money', name: 'trip_cost' });
  pgm.sql('DROP FUNCTION money.assert_trip_cost_allocated()');
};
