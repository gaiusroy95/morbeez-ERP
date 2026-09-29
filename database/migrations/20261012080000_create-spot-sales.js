/* eslint-disable camelcase */

// Driver spot sales: a driver on the road sells from the stock on their
// vehicle to a walk-in buyer, paid on the spot. No governing spec covers
// spot sales (Driver App Architecture's scope is dispatched stops), so this
// follows its general rules — each sale is one client-generated,
// idempotent operation (DRV.5/6), only the trip's own driver may record it
// (DRV.15), the driver never names a lot (DRV.18: the server draws the
// vehicle's own lots, oldest first) — and the Constitution's: money as
// exact decimals (III.2), nothing financial edited or deleted (III.3, III.8).
//
//   spot_settings — the default price band for a product with no band of
//                   its own, as a percentage either side of its base price.
//   price_band    — per product, effective-dated: the lowest and highest
//                   unit price a driver may charge without approval.
//   spot_sale     — the sale: trip, buyer, how they paid, totals, status
//                   (pending_approval → completed | rejected | cancelled).
//                   A price outside its band, or below the stock's cost,
//                   files an approval request ('spot_sale_price'); the
//                   stock is held until it's decided.
//   spot_sale_line — product, quantity, price, the band it was judged by.
//   spot_sale_lot — the lots each line drew, at their own cost (LOT.1).
//
// On completion the sale is invoiced (money.invoice kind 'spot_sale', to
// the tenant's walk-in customer, GST by the tax rules) and paid at once:
// cash to "Cash with drivers" (the driver holds it until the trip is
// reconciled, which now counts it), UPI to the bank. The lots drawn are
// costed to COGS.

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const userColumn = { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };
const productColumn = { type: 'uuid', notNull: true, references: { schema: 'trading_partners', name: 'product' }, onDelete: 'RESTRICT' };
const t = (name) => ({ schema: 'spot', name });

function isolate(pgm, table, updatable) {
  pgm.sql(`ALTER TABLE spot.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE spot.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON spot.${table} USING (tenant_id = current_tenant_id())`);
  pgm.sql(`GRANT SELECT, INSERT ON spot.${table} TO morbeez_app`);
  if (updatable === '*') pgm.sql(`GRANT UPDATE ON spot.${table} TO morbeez_app`);
  else if (updatable.length) pgm.sql(`GRANT UPDATE (${updatable.join(', ')}) ON spot.${table} TO morbeez_app`);
}

const OLD_KINDS = "('sale', 'finance_charge', 'crate_charge')";
const NEW_KINDS = "('sale', 'finance_charge', 'crate_charge', 'spot_sale')";
const OLD_REFS = `(kind = 'sale' AND order_id IS NOT NULL AND source_invoice_id IS NULL) OR
    (kind = 'finance_charge' AND order_id IS NULL AND source_invoice_id IS NOT NULL) OR
    (kind = 'crate_charge' AND order_id IS NULL AND source_invoice_id IS NULL)`;
const NEW_REFS = `${OLD_REFS} OR (kind = 'spot_sale' AND order_id IS NULL AND source_invoice_id IS NULL)`;

exports.up = (pgm) => {
  pgm.createSchema('spot', { ifNotExists: true });
  pgm.sql('GRANT USAGE ON SCHEMA spot TO morbeez_app');

  pgm.createTable(t('spot_settings'), {
    tenant_id: { ...tenantColumn, primaryKey: true },
    default_floor_pct: { type: 'numeric(5,2)', notNull: true, default: 10 },
    default_ceiling_pct: { type: 'numeric(5,2)', notNull: true, default: 25 },
    version: { type: 'integer', notNull: true, default: 1 },
    updated_by: userColumn,
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('spot_settings'), 'spot_settings_valid', {
    check: 'default_floor_pct BETWEEN 0 AND 100 AND default_ceiling_pct BETWEEN 0 AND 500',
  });
  isolate(pgm, 'spot_settings', '*');

  pgm.createTable(t('price_band'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    product_id: productColumn,
    min_price: { type: 'numeric(12,2)', notNull: true },
    max_price: { type: 'numeric(12,2)' },
    effective_from: { type: 'date', notNull: true },
    effective_to: { type: 'date' },
    notes: { type: 'text' },
    created_by: { ...userColumn, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('price_band'), 'price_band_valid', {
    check: 'min_price > 0 AND (max_price IS NULL OR max_price >= min_price) AND (effective_to IS NULL OR effective_to >= effective_from)',
  });
  pgm.addConstraint(t('price_band'), 'price_band_one_per_start', { unique: ['product_id', 'effective_from'] });
  isolate(pgm, 'price_band', ['effective_to']);

  // One walk-in customer per tenant: spot sales are invoiced to it.
  pgm.addColumn({ schema: 'trading_partners', name: 'customer' }, { is_walk_in: { type: 'boolean', notNull: true, default: false } });
  pgm.sql('CREATE UNIQUE INDEX customer_one_walk_in ON trading_partners.customer (tenant_id) WHERE is_walk_in');

  pgm.createTable(t('spot_sale'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    sale_number: { type: 'text', notNull: true },
    client_ref: { type: 'uuid', notNull: true },
    trip_id: { type: 'uuid', notNull: true, references: { schema: 'fulfilment', name: 'trip' }, onDelete: 'RESTRICT' },
    vehicle_id: { type: 'uuid', notNull: true, references: { schema: 'trading_partners', name: 'vehicle' }, onDelete: 'RESTRICT' },
    driver_employee_id: { type: 'uuid', notNull: true, references: { schema: 'trading_partners', name: 'employee' }, onDelete: 'RESTRICT' },
    buyer_name: { type: 'text' },
    buyer_phone: { type: 'text' },
    payment_method: { type: 'text', notNull: true },
    payment_reference: { type: 'text' },
    status: { type: 'text', notNull: true },
    subtotal: { type: 'numeric(12,2)', notNull: true },
    exception_value: { type: 'numeric(12,2)', notNull: true, default: 0 },
    tax_total: { type: 'numeric(12,2)' },
    total: { type: 'numeric(12,2)' },
    cost_total: { type: 'numeric(12,2)' },
    approval_request_id: { type: 'uuid', references: { schema: 'approvals', name: 'approval_request' }, onDelete: 'RESTRICT' },
    invoice_id: { type: 'uuid', references: { schema: 'money', name: 'invoice' }, onDelete: 'RESTRICT' },
    payment_id: { type: 'uuid', references: { schema: 'money', name: 'customer_payment' }, onDelete: 'RESTRICT' },
    sold_at: { type: 'timestamptz', notNull: true },
    completed_at: { type: 'timestamptz' },
    closed_reason: { type: 'text' },
    version: { type: 'integer', notNull: true, default: 1 },
    created_by: { ...userColumn, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('spot_sale'), 'spot_sale_valid', {
    check: `payment_method IN ('cash', 'upi') AND status IN ('pending_approval', 'completed', 'rejected', 'cancelled')
            AND subtotal > 0 AND exception_value >= 0
            AND (status = 'completed') = (invoice_id IS NOT NULL AND payment_id IS NOT NULL AND completed_at IS NOT NULL)
            AND (status NOT IN ('rejected', 'cancelled') OR (closed_reason IS NOT NULL AND approval_request_id IS NOT NULL))`,
    // An in-band sale is written 'pending_approval' with no request and
    // completed in the same transaction; one left pending always has one.
  });
  pgm.addConstraint(t('spot_sale'), 'spot_sale_number_unique', { unique: ['tenant_id', 'sale_number'] });
  pgm.addConstraint(t('spot_sale'), 'spot_sale_client_ref_unique', { unique: ['tenant_id', 'client_ref'] });
  pgm.createIndex(t('spot_sale'), ['tenant_id', 'sold_at']);
  pgm.createIndex(t('spot_sale'), 'trip_id');
  pgm.createIndex(t('spot_sale'), ['vehicle_id', 'status']);
  isolate(pgm, 'spot_sale', ['status', 'tax_total', 'total', 'cost_total', 'invoice_id', 'payment_id', 'completed_at', 'closed_reason', 'version']);

  pgm.createTable(t('spot_sale_line'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    sale_id: { type: 'uuid', notNull: true, references: t('spot_sale'), onDelete: 'RESTRICT' },
    product_id: productColumn,
    quantity: { type: 'numeric(12,3)', notNull: true },
    unit_price: { type: 'numeric(12,2)', notNull: true },
    amount: { type: 'numeric(12,2)', notNull: true },
    band_source: { type: 'text', notNull: true },
    band_min: { type: 'numeric(12,2)' },
    band_max: { type: 'numeric(12,2)' },
    unit_cost_estimate: { type: 'numeric(12,2)' },
    exception: { type: 'text' },
    exception_value: { type: 'numeric(12,2)', notNull: true, default: 0 },
  });
  pgm.addConstraint(t('spot_sale_line'), 'spot_sale_line_valid', {
    check: `quantity > 0 AND unit_price > 0 AND amount > 0 AND band_source IN ('band', 'default', 'none')
            AND (exception IS NULL OR exception IN ('below_band', 'above_band', 'no_band', 'below_cost'))
            AND (exception IS NULL) = (exception_value = 0)`,
  });
  pgm.createIndex(t('spot_sale_line'), 'sale_id');
  isolate(pgm, 'spot_sale_line', []);

  pgm.createTable(t('spot_sale_lot'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    line_id: { type: 'uuid', notNull: true, references: t('spot_sale_line'), onDelete: 'RESTRICT' },
    lot_id: { type: 'uuid', notNull: true, references: { schema: 'commerce', name: 'lot' }, onDelete: 'RESTRICT' },
    quantity: { type: 'numeric(12,3)', notNull: true },
    unit_cost: { type: 'numeric(12,2)', notNull: true },
  });
  pgm.addConstraint(t('spot_sale_lot'), 'spot_sale_lot_positive', { check: 'quantity > 0 AND unit_cost >= 0' });
  pgm.createIndex(t('spot_sale_lot'), 'line_id');
  isolate(pgm, 'spot_sale_lot', []);

  // ---- Wiring into Finance, Inventory and Logistics ----
  pgm.sql('ALTER TABLE money.invoice DROP CONSTRAINT invoice_kind_valid');
  pgm.sql(`ALTER TABLE money.invoice ADD CONSTRAINT invoice_kind_valid CHECK (kind IN ${NEW_KINDS})`);
  pgm.sql('ALTER TABLE money.invoice DROP CONSTRAINT invoice_kind_references');
  pgm.sql(`ALTER TABLE money.invoice ADD CONSTRAINT invoice_kind_references CHECK (${NEW_REFS})`);
  pgm.sql('ALTER TABLE money.invoice_counter DROP CONSTRAINT invoice_counter_kind_valid');
  pgm.sql(`ALTER TABLE money.invoice_counter ADD CONSTRAINT invoice_counter_kind_valid CHECK (kind IN ${NEW_KINDS})`);

  pgm.sql('ALTER TABLE stock.inventory_movement DROP CONSTRAINT inventory_movement_type_valid');
  pgm.sql("ALTER TABLE stock.inventory_movement ADD CONSTRAINT inventory_movement_type_valid CHECK (movement_type IN ('shrinkage', 'rejected_post_acceptance', 'transferred', 'spot_sold'))");

  // A reconciliation now also expects back the cash the driver took for spot sales.
  pgm.addColumn({ schema: 'fulfilment', name: 'trip_reconciliation' }, { spot_cash: { type: 'numeric(12,2)', notNull: true, default: 0 } });

  pgm.sql(`
    INSERT INTO identity.permission (code, description) VALUES
      ('spot_sales:read', 'See spot sales and price bands'),
      ('spot_sales:record', 'Record a spot sale on a trip (a driver: only on their own trip)'),
      ('spot_sales:configure', 'Set price bands for spot sales')
    ON CONFLICT (code) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql("DELETE FROM identity.permission WHERE code IN ('spot_sales:read', 'spot_sales:record', 'spot_sales:configure')");
  pgm.dropColumn({ schema: 'fulfilment', name: 'trip_reconciliation' }, 'spot_cash');
  pgm.sql("DELETE FROM stock.inventory_movement WHERE movement_type = 'spot_sold'");
  pgm.sql('ALTER TABLE stock.inventory_movement DROP CONSTRAINT inventory_movement_type_valid');
  pgm.sql("ALTER TABLE stock.inventory_movement ADD CONSTRAINT inventory_movement_type_valid CHECK (movement_type IN ('shrinkage', 'rejected_post_acceptance', 'transferred'))");
  pgm.dropSchema('spot', { cascade: true });
  pgm.sql("DELETE FROM money.invoice_counter WHERE kind = 'spot_sale'");
  pgm.sql('ALTER TABLE money.invoice_counter DROP CONSTRAINT invoice_counter_kind_valid');
  pgm.sql(`ALTER TABLE money.invoice_counter ADD CONSTRAINT invoice_counter_kind_valid CHECK (kind IN ${OLD_KINDS})`);
  pgm.sql('ALTER TABLE money.invoice DROP CONSTRAINT invoice_kind_references');
  pgm.sql(`ALTER TABLE money.invoice ADD CONSTRAINT invoice_kind_references CHECK (${OLD_REFS})`);
  pgm.sql('ALTER TABLE money.invoice DROP CONSTRAINT invoice_kind_valid');
  pgm.sql(`ALTER TABLE money.invoice ADD CONSTRAINT invoice_kind_valid CHECK (kind IN ${OLD_KINDS})`);
  pgm.sql('DROP INDEX trading_partners.customer_one_walk_in');
  pgm.dropColumn({ schema: 'trading_partners', name: 'customer' }, 'is_walk_in');
};
