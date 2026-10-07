/* eslint-disable camelcase */

// Pilot baseline, client Q&A 1–2 Oct 2026 (live chicken, eggs, pricing,
// finance charges, disputes):
//
// 1. Product kinds. 'live_bird' is sold by live weight (kg): the farm
//    weighment is the primary, commercial weight; a customer-end weighment,
//    when one is taken, is the settlement weight the invoice uses, and the
//    difference is transit shrinkage. 'egg' is counted in pieces, bought and
//    sold by piece or tray (pack_size pieces to a tray, set by the owner);
//    broken eggs are a loss. Each kind has a loss tolerance (shrinkage or
//    breakage %), per product or the business-wide default; above it, the
//    owner is alerted. No tare workflow: the driver enters the net kg.
//
// 2. No permanent selling price. base_price becomes an optional reference
//    (set, for instance, by accepting an AI price suggestion); a new order
//    line is suggested the last actual price for that customer and product.
//
// 3. Delivery measures (fulfilment.delivery_line_measure): per order line
//    delivered, what left (dispatched), what the customer was charged for
//    (settled), and why they differ — the customer-end weight, or eggs
//    broken. Insert-only, for audit.
//
// 4. Finance charge = outstanding principal × annual rate × overdue days
//    ÷ 365 (customer.finance_charge_rate_annual). Existing monthly rates
//    carry over at the same daily cost (× 365 ÷ 30). Past charges keep the
//    rate they were computed with.
//
// 5. Disputes (money.invoice_dispute): a customer disputes part or all of an
//    invoice; finance charges pause on the disputed amount only. Untouched
//    for 30 days it becomes a critical exception for the owner. Resolving it
//    never writes anything off or reverses anything by itself.

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const userColumn = { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };
const OLD_UOMS = ['kg', 'g', 'crate', 'bag', 'dozen', 'unit'];
const UOMS = [...OLD_UOMS, 'piece'];
const OLD_PHOTO_TYPES = ['pickup', 'delivery', 'pod', 'issue'];
const PHOTO_TYPES = [...OLD_PHOTO_TYPES, 'weighment'];
const OLD_ALERT_KINDS = [
  'cash_mismatch', 'collection_discrepancy', 'inventory_mismatch', 'customer_rejection',
  'procurement_issue', 'driver_unable_to_continue', 'trip_blocked', 'operational_problem', 'security',
];
const ALERT_KINDS = [...OLD_ALERT_KINDS, 'shrinkage', 'breakage', 'dispute_stale'];
const list = (xs) => xs.map((x) => `'${x}'`).join(', ');

function isolate(pgm, schema, table) {
  pgm.sql(`ALTER TABLE ${schema}.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE ${schema}.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON ${schema}.${table} USING (tenant_id = current_tenant_id())`);
}

exports.up = (pgm) => {
  // ---- Products ----
  pgm.dropConstraint({ schema: 'trading_partners', name: 'product' }, 'product_base_uom_valid');
  pgm.addConstraint({ schema: 'trading_partners', name: 'product' }, 'product_base_uom_valid', { check: `base_uom IN (${list(UOMS)})` });
  pgm.addColumns({ schema: 'trading_partners', name: 'product' }, {
    kind: { type: 'text', notNull: true, default: 'standard' },
    // Eggs: pieces to a tray.
    pack_size: { type: 'integer' },
    // Shrinkage (live birds) or breakage (eggs) the owner accepts, %; null = the business default.
    loss_tolerance_pct: { type: 'numeric(5,2)' },
  });
  pgm.addConstraint({ schema: 'trading_partners', name: 'product' }, 'product_kind_valid', {
    check: `kind IN ('standard', 'live_bird', 'egg')
            AND (kind <> 'live_bird' OR base_uom = 'kg')
            AND (kind <> 'egg' OR (base_uom = 'piece' AND pack_size IS NOT NULL))
            AND (pack_size IS NULL OR pack_size BETWEEN 2 AND 1000)
            AND (loss_tolerance_pct IS NULL OR loss_tolerance_pct BETWEEN 0 AND 100)`,
  });
  // An optional reference only: orders never price from it.
  pgm.sql('ALTER TABLE trading_partners.product ALTER COLUMN base_price DROP NOT NULL');
  pgm.sql('ALTER TABLE trading_partners.product ALTER COLUMN base_price DROP DEFAULT');

  // ---- Business rules ----
  pgm.addColumns({ schema: 'tenant', name: 'tenant' }, {
    default_shrinkage_tolerance_pct: { type: 'numeric(5,2)', notNull: true, default: 2 },
    default_breakage_tolerance_pct: { type: 'numeric(5,2)', notNull: true, default: 1 },
    // Photo of the customer's scale when a customer-end weight is entered.
    weighment_photo: { type: 'text', notNull: true, default: 'optional' },
  });
  pgm.addConstraint({ schema: 'tenant', name: 'tenant' }, 'tenant_loss_rules_valid', {
    check: `default_shrinkage_tolerance_pct BETWEEN 0 AND 100 AND default_breakage_tolerance_pct BETWEEN 0 AND 100
            AND weighment_photo IN ('optional', 'required', 'not_required')`,
  });

  // ---- Delivery measures ----
  pgm.createTable({ schema: 'fulfilment', name: 'delivery_line_measure' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    trip_stop_id: { type: 'uuid', notNull: true, references: { schema: 'fulfilment', name: 'trip_stop' }, onDelete: 'RESTRICT' },
    order_line_id: { type: 'uuid', notNull: true, references: { schema: 'commerce', name: 'customer_order_line' }, onDelete: 'RESTRICT' },
    product_id: { type: 'uuid', notNull: true, references: { schema: 'trading_partners', name: 'product' }, onDelete: 'RESTRICT' },
    kind: { type: 'text', notNull: true },
    // What left on the vehicle (the farm weight for live birds).
    dispatched_quantity: { type: 'numeric(12,3)', notNull: true },
    // What the customer is charged for.
    settled_quantity: { type: 'numeric(12,3)', notNull: true },
    loss_quantity: { type: 'numeric(12,3)', notNull: true },
    loss_pct: { type: 'numeric(6,2)', notNull: true },
    tolerance_pct: { type: 'numeric(5,2)', notNull: true },
    within_tolerance: { type: 'boolean', notNull: true },
    recorded_by: { ...userColumn, notNull: true },
    recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint({ schema: 'fulfilment', name: 'delivery_line_measure' }, 'delivery_line_measure_valid', {
    check: `kind IN ('weighment', 'breakage') AND dispatched_quantity > 0 AND settled_quantity >= 0
            AND loss_quantity = dispatched_quantity - settled_quantity`,
  });
  pgm.addConstraint({ schema: 'fulfilment', name: 'delivery_line_measure' }, 'delivery_line_measure_once', { unique: ['order_line_id'] });
  pgm.createIndex({ schema: 'fulfilment', name: 'delivery_line_measure' }, ['tenant_id', 'trip_stop_id']);
  isolate(pgm, 'fulfilment', 'delivery_line_measure');
  pgm.sql('REVOKE UPDATE, DELETE ON fulfilment.delivery_line_measure FROM morbeez_app');

  pgm.dropConstraint({ schema: 'fulfilment', name: 'trip_stop_photo' }, 'trip_stop_photo_type_valid');
  pgm.addConstraint({ schema: 'fulfilment', name: 'trip_stop_photo' }, 'trip_stop_photo_type_valid', { check: `photo_type IN (${list(PHOTO_TYPES)})` });

  // ---- Finance charges: annual rate ÷ 365 ----
  pgm.addColumn({ schema: 'trading_partners', name: 'customer' }, {
    finance_charge_rate_annual: { type: 'numeric(6,2)', notNull: true, default: 0 },
  });
  pgm.sql('UPDATE trading_partners.customer SET finance_charge_rate_annual = round(finance_charge_rate_monthly * 365 / 30, 2)');
  pgm.addConstraint({ schema: 'trading_partners', name: 'customer' }, 'customer_finance_charge_annual_range', {
    check: 'finance_charge_rate_annual BETWEEN 0 AND 60',
  });
  pgm.addColumn({ schema: 'money', name: 'finance_charge' }, { rate_annual_percent: { type: 'numeric(6,2)' } });
  pgm.sql('ALTER TABLE money.finance_charge ALTER COLUMN rate_monthly_percent DROP NOT NULL');
  pgm.dropConstraint({ schema: 'money', name: 'finance_charge' }, 'finance_charge_values_valid');
  pgm.addConstraint({ schema: 'money', name: 'finance_charge' }, 'finance_charge_values_valid', {
    check: `period_end > period_start AND days = period_end - period_start AND principal > 0 AND amount > 0
            AND ((rate_monthly_percent IS NOT NULL AND rate_monthly_percent > 0) <> (rate_annual_percent IS NOT NULL AND rate_annual_percent > 0))`,
  });

  // ---- Disputes ----
  pgm.createTable({ schema: 'money', name: 'invoice_dispute' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    invoice_id: { type: 'uuid', notNull: true, references: { schema: 'money', name: 'invoice' }, onDelete: 'RESTRICT' },
    customer_id: { type: 'uuid', notNull: true, references: { schema: 'trading_partners', name: 'customer' }, onDelete: 'RESTRICT' },
    amount: { type: 'numeric(12,2)', notNull: true },
    reason: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'open' },
    // Notes as they come: [{ at, by, text }].
    notes: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    raised_by: { ...userColumn, notNull: true },
    raised_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_activity_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    resolved_by: userColumn,
    resolved_at: { type: 'timestamptz' },
    resolution: { type: 'text' },
    version: { type: 'integer', notNull: true, default: 1 },
  });
  pgm.addConstraint({ schema: 'money', name: 'invoice_dispute' }, 'invoice_dispute_valid', {
    check: `amount > 0 AND status IN ('open', 'resolved', 'withdrawn')
            AND (status = 'open') = (resolved_at IS NULL) AND (status = 'open' OR resolution IS NOT NULL)`,
  });
  pgm.createIndex({ schema: 'money', name: 'invoice_dispute' }, ['tenant_id', 'invoice_id']);
  pgm.createIndex({ schema: 'money', name: 'invoice_dispute' }, ['tenant_id', 'status', 'last_activity_at']);
  isolate(pgm, 'money', 'invoice_dispute');
  pgm.sql('GRANT SELECT, INSERT, UPDATE ON money.invoice_dispute TO morbeez_app');
  pgm.sql('REVOKE DELETE ON money.invoice_dispute FROM morbeez_app');

  pgm.dropConstraint({ schema: 'tenant', name: 'owner_alert' }, 'owner_alert_valid');
  pgm.addConstraint({ schema: 'tenant', name: 'owner_alert' }, 'owner_alert_valid', {
    check: `severity IN ('critical', 'warning') AND kind IN (${list(ALERT_KINDS)})`,
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint({ schema: 'tenant', name: 'owner_alert' }, 'owner_alert_valid');
  pgm.addConstraint({ schema: 'tenant', name: 'owner_alert' }, 'owner_alert_valid', {
    check: `severity IN ('critical', 'warning') AND kind IN (${list(OLD_ALERT_KINDS)})`,
  });
  pgm.dropTable({ schema: 'money', name: 'invoice_dispute' });
  pgm.dropConstraint({ schema: 'money', name: 'finance_charge' }, 'finance_charge_values_valid');
  pgm.sql('DELETE FROM money.finance_charge WHERE rate_monthly_percent IS NULL'); // refuses if posted; reverse those first
  pgm.sql('ALTER TABLE money.finance_charge ALTER COLUMN rate_monthly_percent SET NOT NULL');
  pgm.addConstraint({ schema: 'money', name: 'finance_charge' }, 'finance_charge_values_valid', {
    check: 'period_end > period_start AND days = period_end - period_start AND principal > 0 AND rate_monthly_percent > 0 AND amount > 0',
  });
  pgm.dropColumn({ schema: 'money', name: 'finance_charge' }, 'rate_annual_percent');
  pgm.dropConstraint({ schema: 'trading_partners', name: 'customer' }, 'customer_finance_charge_annual_range');
  pgm.dropColumn({ schema: 'trading_partners', name: 'customer' }, 'finance_charge_rate_annual');
  pgm.dropConstraint({ schema: 'fulfilment', name: 'trip_stop_photo' }, 'trip_stop_photo_type_valid');
  pgm.addConstraint({ schema: 'fulfilment', name: 'trip_stop_photo' }, 'trip_stop_photo_type_valid', { check: `photo_type IN (${list(OLD_PHOTO_TYPES)})` });
  pgm.dropTable({ schema: 'fulfilment', name: 'delivery_line_measure' });
  pgm.dropConstraint({ schema: 'tenant', name: 'tenant' }, 'tenant_loss_rules_valid');
  pgm.dropColumns({ schema: 'tenant', name: 'tenant' }, ['default_shrinkage_tolerance_pct', 'default_breakage_tolerance_pct', 'weighment_photo']);
  pgm.sql('UPDATE trading_partners.product SET base_price = 0 WHERE base_price IS NULL');
  pgm.sql('ALTER TABLE trading_partners.product ALTER COLUMN base_price SET DEFAULT 0');
  pgm.sql('ALTER TABLE trading_partners.product ALTER COLUMN base_price SET NOT NULL');
  pgm.dropConstraint({ schema: 'trading_partners', name: 'product' }, 'product_kind_valid');
  pgm.dropColumns({ schema: 'trading_partners', name: 'product' }, ['kind', 'pack_size', 'loss_tolerance_pct']);
  pgm.dropConstraint({ schema: 'trading_partners', name: 'product' }, 'product_base_uom_valid');
  pgm.addConstraint({ schema: 'trading_partners', name: 'product' }, 'product_base_uom_valid', { check: `base_uom IN (${list(OLD_UOMS)})` });
};
