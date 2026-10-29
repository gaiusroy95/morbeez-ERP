/* eslint-disable camelcase */

// Driver app V1, Phase D3 — delivery (docs/redesign/driver-app-v1-plan.md;
// client spec §11–§14, the client's answer 5):
//
// 1. A QR per customer (trading_partners.customer.qr_token), printed from
//    the customer's profile in the owner app and scanned by the driver at
//    the door. A wrong customer's QR blocks the delivery; a missing or
//    damaged one doesn't — the delivery is recorded as not scanned.
// 2. The delivery's checklist on its proof of delivery: QR scanned or not
//    (and why not), everything delivered unloaded.
// 3. fulfilment.delivery_shortfall: an order line delivered short, and why
//    (the invoice follows what was delivered — never a driver deduction).
//    Insert-only.
// 4. When the delivery run set off (Start Trip, after the farms).

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const userColumn = { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };

const CUSTOMER = { schema: 'trading_partners', name: 'customer' };
const TRIP = { schema: 'fulfilment', name: 'trip' };
const POD = { schema: 'fulfilment', name: 'trip_stop_pod' };
const SHORT = { schema: 'fulfilment', name: 'delivery_shortfall' };

const SHORT_REASONS = ['customer_took_less', 'damaged', 'not_enough_on_vehicle', 'quality_issue', 'other'];
const list = (xs) => xs.map((x) => `'${x}'`).join(', ');
// 16 hex characters: unguessable enough to tell one shop from another, short enough to print.
const NEW_TOKEN = "upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))";

exports.up = (pgm) => {
  // A volatile default is evaluated per existing row: every customer gets their own.
  pgm.addColumns(CUSTOMER, { qr_token: { type: 'text', notNull: true, default: pgm.func(NEW_TOKEN) } });
  pgm.addConstraint(CUSTOMER, 'customer_qr_token_unique', { unique: ['tenant_id', 'qr_token'] });

  pgm.addColumns(TRIP, { delivery_started_at: { type: 'timestamptz' } });

  pgm.addColumns(POD, {
    qr_status: { type: 'text' },
    qr_note: { type: 'text' },
    all_unloaded: { type: 'boolean' },
  });
  pgm.addConstraint(POD, 'trip_stop_pod_qr_valid', {
    check: `qr_status IS NULL OR qr_status IN ('scanned', 'not_scanned')`,
  });

  pgm.createTable(SHORT, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    trip_stop_id: { type: 'uuid', notNull: true, references: { schema: 'fulfilment', name: 'trip_stop' }, onDelete: 'RESTRICT' },
    order_line_id: { type: 'uuid', notNull: true, references: { schema: 'commerce', name: 'customer_order_line' }, onDelete: 'RESTRICT' },
    ordered_quantity: { type: 'numeric(12,3)', notNull: true },
    delivered_quantity: { type: 'numeric(12,3)', notNull: true },
    reason: { type: 'text', notNull: true },
    note: { type: 'text' },
    recorded_by: { ...userColumn, notNull: true },
    recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(SHORT, 'delivery_shortfall_valid', {
    check: `delivered_quantity >= 0 AND delivered_quantity < ordered_quantity AND reason IN (${list(SHORT_REASONS)})`,
  });
  pgm.addConstraint(SHORT, 'delivery_shortfall_once', { unique: ['trip_stop_id', 'order_line_id'] });
  pgm.createIndex(SHORT, ['tenant_id', 'trip_stop_id']);
  pgm.sql('ALTER TABLE fulfilment.delivery_shortfall ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE fulfilment.delivery_shortfall FORCE ROW LEVEL SECURITY');
  pgm.sql('CREATE POLICY delivery_shortfall_tenant_isolation ON fulfilment.delivery_shortfall USING (tenant_id = current_tenant_id())');
  pgm.sql('GRANT SELECT, INSERT ON fulfilment.delivery_shortfall TO morbeez_app');
  pgm.sql('REVOKE UPDATE, DELETE ON fulfilment.delivery_shortfall FROM morbeez_app');
};

exports.down = (pgm) => {
  pgm.dropTable(SHORT);
  pgm.dropConstraint(POD, 'trip_stop_pod_qr_valid');
  pgm.dropColumns(POD, ['qr_status', 'qr_note', 'all_unloaded']);
  pgm.dropColumns(TRIP, ['delivery_started_at']);
  pgm.dropConstraint(CUSTOMER, 'customer_qr_token_unique');
  pgm.dropColumns(CUSTOMER, ['qr_token']);
};
