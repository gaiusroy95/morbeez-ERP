/* eslint-disable camelcase */

// Driver app V1, Phase D0 — stock by the kilo (docs/redesign/driver-app-v1-plan.md).
//
// 1. stock.lot_balance: a lot's kilos at one place — the store (no
//    location), a warehouse, or a vehicle. Part of a lot can now be loaded
//    onto a vehicle while the rest stays behind. lot.current_quantity stays
//    the lot's total, always the sum of its balances.
// 2. commerce.lot_allocation: an order line's claim on a balance — kilos
//    reserved for it and not yet delivered, and kilos delivered from it.
//    It replaces lot.reserved_for_order_line_id, which claimed whole lots:
//    cost of goods is now exactly the delivered kilos at their lots' cost.
// 3. Lots reserved whole become 'available' with their kilos reserved.
//    Lots an earlier delivery consumed whole give back the kilos that
//    delivery didn't take — they were never sold, and the books still
//    carry them as inventory. Each lot of a line is taken in proportion,
//    which is how that delivery's cost of goods was worked out.
// 4. customer_order_line.delivered_quantity: what left with the delivery.
// 5. stock.inventory_movement: a trip's stock moves — loaded at the start,
//    picked up at a farm, delivered, returned at closing — with the trip.

exports.shorthands = undefined;

const LOT = { schema: 'commerce', name: 'lot' };
const BALANCE = { schema: 'stock', name: 'lot_balance' };
const ALLOCATION = { schema: 'commerce', name: 'lot_allocation' };
const MOVEMENT = { schema: 'stock', name: 'inventory_movement' };
const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const inList = (values) => values.map((v) => `'${v}'`).join(', ');

const OLD_MOVEMENTS = ['shrinkage', 'rejected_post_acceptance', 'transferred', 'spot_sold'];
const NEW_MOVEMENTS = [...OLD_MOVEMENTS, 'loaded', 'picked_up', 'delivered', 'returned'];

function isolate(pgm, schema, table) {
  pgm.sql(`ALTER TABLE ${schema}.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE ${schema}.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON ${schema}.${table} USING (tenant_id = current_tenant_id())`);
}

exports.up = (pgm) => {
  pgm.createTable(BALANCE, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    lot_id: { type: 'uuid', notNull: true, references: LOT, onDelete: 'RESTRICT' },
    product_id: { type: 'uuid', notNull: true, references: { schema: 'trading_partners', name: 'product' }, onDelete: 'RESTRICT' },
    location_id: { type: 'uuid', references: { schema: 'stock', name: 'location' }, onDelete: 'RESTRICT' },
    quantity: { type: 'numeric(12,3)', notNull: true, default: 0 },
    reserved_quantity: { type: 'numeric(12,3)', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(BALANCE, 'lot_balance_quantities_valid', {
    check: 'quantity >= 0 AND reserved_quantity >= 0 AND reserved_quantity <= quantity',
  });
  pgm.createIndex(BALANCE, ['tenant_id', 'product_id']);
  pgm.createIndex(BALANCE, 'lot_id');
  pgm.createIndex(BALANCE, 'location_id');

  pgm.createTable(ALLOCATION, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    balance_id: { type: 'uuid', notNull: true, references: BALANCE, onDelete: 'RESTRICT' },
    lot_id: { type: 'uuid', notNull: true, references: LOT, onDelete: 'RESTRICT' },
    order_line_id: { type: 'uuid', notNull: true, references: { schema: 'commerce', name: 'customer_order_line' }, onDelete: 'RESTRICT' },
    reserved_quantity: { type: 'numeric(12,3)', notNull: true, default: 0 },
    delivered_quantity: { type: 'numeric(12,3)', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(ALLOCATION, 'lot_allocation_quantities_valid', {
    check: 'reserved_quantity >= 0 AND delivered_quantity >= 0 AND (reserved_quantity > 0 OR delivered_quantity > 0)',
  });
  pgm.addConstraint(ALLOCATION, 'lot_allocation_once_per_balance', { unique: ['balance_id', 'order_line_id'] });
  pgm.createIndex(ALLOCATION, 'order_line_id');
  pgm.createIndex(ALLOCATION, 'lot_id');

  pgm.addColumns({ schema: 'commerce', name: 'customer_order_line' }, {
    delivered_quantity: { type: 'numeric(12,3)' },
  });

  // FORCE ROW LEVEL SECURITY would hide every row from a non-superuser
  // owner (RDS, Neon), so it's lifted around the backfills. The two new
  // tables are isolated once they're filled.
  pgm.sql('ALTER TABLE commerce.lot NO FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE commerce.customer_order NO FORCE ROW LEVEL SECURITY');
  pgm.dropConstraint(LOT, 'lot_reserved_iff_flagged');

  pgm.sql(`
    UPDATE commerce.customer_order_line ol SET delivered_quantity = ol.quantity
    FROM commerce.customer_order o WHERE o.id = ol.order_id AND o.status = 'delivered'
  `);

  // What each whole-consumed lot really gave its delivery.
  pgm.sql(`
    CREATE TEMP TABLE d0_delivered ON COMMIT DROP AS
    SELECT lot_id, line_id, LEAST(q, ROUND(d * q / total, 3)) AS delivered
    FROM (
      SELECT l.id AS lot_id, l.reserved_for_order_line_id AS line_id, l.current_quantity AS q, ol.quantity AS d,
             SUM(l.current_quantity) OVER (PARTITION BY l.reserved_for_order_line_id) AS total
      FROM commerce.lot l JOIN commerce.customer_order_line ol ON ol.id = l.reserved_for_order_line_id
      WHERE l.status = 'delivered' AND l.current_quantity > 0
    ) x
    WHERE total > 0
  `);

  // A lot reserved whole for a line now holds only what the line still
  // needs, oldest lot first; the rest of it is free again.
  pgm.sql(`
    CREATE TEMP TABLE d0_reserved ON COMMIT DROP AS
    SELECT lot_id, line_id, LEAST(q, GREATEST(need - before, 0)) AS reserved
    FROM (
      SELECT l.id AS lot_id, l.reserved_for_order_line_id AS line_id, l.current_quantity AS q, ol.quantity AS need,
             COALESCE(SUM(l.current_quantity) OVER (PARTITION BY l.reserved_for_order_line_id ORDER BY l.received_at, l.id
                                                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before
      FROM commerce.lot l JOIN commerce.customer_order_line ol ON ol.id = l.reserved_for_order_line_id
      WHERE l.status = 'reserved' AND l.current_quantity > 0
    ) x
  `);

  pgm.sql(`
    INSERT INTO stock.lot_balance (tenant_id, lot_id, product_id, location_id, quantity, reserved_quantity)
    SELECT l.tenant_id, l.id, l.product_id, l.current_location_id,
           l.current_quantity - COALESCE(d.delivered, 0),
           COALESCE(r.reserved, 0)
    FROM commerce.lot l
    LEFT JOIN d0_delivered d ON d.lot_id = l.id
    LEFT JOIN d0_reserved r ON r.lot_id = l.id
    WHERE l.graded_at IS NOT NULL AND l.current_quantity IS NOT NULL AND l.status IN ('available', 'reserved', 'delivered')
  `);
  pgm.sql(`
    INSERT INTO commerce.lot_allocation (tenant_id, balance_id, lot_id, order_line_id, reserved_quantity)
    SELECT b.tenant_id, b.id, r.lot_id, r.line_id, r.reserved
    FROM d0_reserved r JOIN stock.lot_balance b ON b.lot_id = r.lot_id
    WHERE r.reserved > 0
  `);
  pgm.sql(`
    INSERT INTO commerce.lot_allocation (tenant_id, balance_id, lot_id, order_line_id, delivered_quantity)
    SELECT b.tenant_id, b.id, d.lot_id, d.line_id, d.delivered
    FROM d0_delivered d JOIN stock.lot_balance b ON b.lot_id = d.lot_id
    WHERE d.delivered > 0
  `);
  pgm.sql(`
    UPDATE commerce.lot l SET current_quantity = l.current_quantity - d.delivered,
           status = CASE WHEN l.current_quantity - d.delivered > 0 THEN 'available' ELSE 'delivered' END,
           version = l.version + 1, updated_at = now()
    FROM d0_delivered d WHERE d.lot_id = l.id
  `);
  pgm.sql(`UPDATE commerce.lot SET status = 'available', version = version + 1, updated_at = now() WHERE status = 'reserved'`);

  pgm.sql('ALTER TABLE commerce.customer_order FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE commerce.lot FORCE ROW LEVEL SECURITY');
  isolate(pgm, 'stock', 'lot_balance');
  isolate(pgm, 'commerce', 'lot_allocation');
  // The schemas' default grants cover these; said outright all the same,
  // since the AI's read-only role now reads stock from them.
  pgm.sql('GRANT SELECT, INSERT, UPDATE, DELETE ON stock.lot_balance, commerce.lot_allocation TO morbeez_app');
  pgm.sql('GRANT SELECT ON stock.lot_balance, commerce.lot_allocation TO morbeez_ai');

  pgm.dropColumns(LOT, ['reserved_for_order_line_id', 'current_location_id']);
  pgm.dropConstraint(LOT, 'lot_status_valid');
  pgm.addConstraint(LOT, 'lot_status_valid', { check: `status IN (${inList(['received_ungraded', 'available', 'delivered', 'rejected'])})` });

  pgm.addColumns(MOVEMENT, {
    trip_id: { type: 'uuid', references: { schema: 'fulfilment', name: 'trip' }, onDelete: 'RESTRICT' },
  });
  pgm.sql('ALTER TABLE stock.inventory_movement DROP CONSTRAINT inventory_movement_type_valid');
  pgm.sql(`ALTER TABLE stock.inventory_movement ADD CONSTRAINT inventory_movement_type_valid CHECK (movement_type IN (${inList(NEW_MOVEMENTS)}))`);
  pgm.createIndex(MOVEMENT, 'trip_id', { where: 'trip_id IS NOT NULL' });
};

exports.down = (pgm) => {
  pgm.dropIndex(MOVEMENT, 'trip_id');
  pgm.sql('ALTER TABLE stock.inventory_movement NO FORCE ROW LEVEL SECURITY');
  pgm.sql(`DELETE FROM stock.inventory_movement WHERE movement_type IN (${inList(NEW_MOVEMENTS.filter((m) => !OLD_MOVEMENTS.includes(m)))})`);
  pgm.sql('ALTER TABLE stock.inventory_movement FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE stock.inventory_movement DROP CONSTRAINT inventory_movement_type_valid');
  pgm.sql(`ALTER TABLE stock.inventory_movement ADD CONSTRAINT inventory_movement_type_valid CHECK (movement_type IN (${inList(OLD_MOVEMENTS)}))`);
  pgm.dropColumns(MOVEMENT, ['trip_id']);

  // Back to whole lots, as near as they go: a lot sits where most of it
  // is, and a lot with kilos reserved is reserved for that line.
  pgm.dropConstraint(LOT, 'lot_status_valid');
  pgm.addConstraint(LOT, 'lot_status_valid', {
    check: `status IN (${inList(['received_ungraded', 'available', 'reserved', 'delivered', 'rejected'])})`,
  });
  pgm.addColumns(LOT, {
    reserved_for_order_line_id: { type: 'uuid', references: { schema: 'commerce', name: 'customer_order_line' }, onDelete: 'RESTRICT' },
    current_location_id: { type: 'uuid', references: { schema: 'stock', name: 'location' }, onDelete: 'RESTRICT' },
  });
  pgm.createIndex(LOT, 'reserved_for_order_line_id');
  pgm.createIndex(LOT, 'current_location_id');
  pgm.sql('ALTER TABLE commerce.lot NO FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE stock.lot_balance NO FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE commerce.lot_allocation NO FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    UPDATE commerce.lot l SET current_location_id = b.location_id
    FROM (SELECT DISTINCT ON (lot_id) lot_id, location_id FROM stock.lot_balance ORDER BY lot_id, quantity DESC) b
    WHERE b.lot_id = l.id
  `);
  pgm.sql(`
    UPDATE commerce.lot l SET status = 'reserved', reserved_for_order_line_id = a.order_line_id
    FROM (SELECT DISTINCT ON (lot_id) lot_id, order_line_id FROM commerce.lot_allocation WHERE reserved_quantity > 0 ORDER BY lot_id, reserved_quantity DESC) a
    WHERE a.lot_id = l.id AND l.status = 'available'
  `);
  pgm.sql(`
    UPDATE commerce.lot l SET reserved_for_order_line_id = a.order_line_id
    FROM (SELECT DISTINCT ON (lot_id) lot_id, order_line_id FROM commerce.lot_allocation WHERE delivered_quantity > 0 ORDER BY lot_id, delivered_quantity DESC) a
    WHERE a.lot_id = l.id AND l.status = 'delivered'
  `);
  pgm.sql(`UPDATE commerce.lot SET status = 'available' WHERE status = 'delivered' AND reserved_for_order_line_id IS NULL`);
  pgm.sql('ALTER TABLE commerce.lot FORCE ROW LEVEL SECURITY');
  pgm.addConstraint(LOT, 'lot_reserved_iff_flagged', {
    check: "(status IN ('reserved', 'delivered')) = (reserved_for_order_line_id IS NOT NULL)",
  });

  pgm.dropColumns({ schema: 'commerce', name: 'customer_order_line' }, ['delivered_quantity']);
  pgm.dropTable(ALLOCATION);
  pgm.dropTable(BALANCE);
};
