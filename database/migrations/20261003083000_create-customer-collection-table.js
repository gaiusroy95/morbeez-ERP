/* eslint-disable camelcase */

// Cash/payment collected from a customer at a delivery stop — the
// delivery-side mirror of money.farmer_settlement. An operational fact,
// not a double-entry posting: Finance/Accounting don't exist as an
// implemented ledger yet, same scope boundary drawn there. tenant_id/RLS
// of its own (unlike trip_stop_photo/pod) because this is the kind of
// record Finance will eventually query by order or customer directly,
// not only ever through a trip.

exports.shorthands = undefined;

const VALID_METHODS = ['cash', 'upi', 'bank_transfer', 'cheque'];

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'money', name: 'customer_collection' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      trip_stop_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'fulfilment', name: 'trip_stop' },
        onDelete: 'RESTRICT',
      },
      order_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'commerce', name: 'customer_order' },
        onDelete: 'RESTRICT',
      },
      amount: { type: 'numeric(12,2)', notNull: true },
      method: { type: 'text', notNull: true },
      notes: { type: 'text' },
      collected_by: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
      collected_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'money', name: 'customer_collection' }, 'customer_collection_amount_positive', {
    check: 'amount > 0',
  });
  pgm.addConstraint({ schema: 'money', name: 'customer_collection' }, 'customer_collection_method_valid', {
    check: `method IN (${VALID_METHODS.map((m) => `'${m}'`).join(', ')})`,
  });
  pgm.createIndex({ schema: 'money', name: 'customer_collection' }, ['tenant_id', 'order_id']);
  pgm.createIndex({ schema: 'money', name: 'customer_collection' }, 'trip_stop_id');
  pgm.sql('ALTER TABLE money.customer_collection ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE money.customer_collection FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY customer_collection_tenant_isolation ON money.customer_collection
      USING (tenant_id = current_tenant_id())
  `);
  // Insert + read only — same posture as money.farmer_settlement.
  pgm.sql('REVOKE UPDATE, DELETE ON money.customer_collection FROM morbeez_app');
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'money', name: 'customer_collection' });
};
