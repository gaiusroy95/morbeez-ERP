/* eslint-disable camelcase */

// The operational fact of "this lot was paid for" — not a double-entry
// ledger posting. Finance/Accounting don't exist as implemented modules
// yet; when they do, this table (or the event a future
// farmer_settlement.recorded would carry) is what they'd consume to post
// the actual Dr Accounts Payable / Cr Cash journal (Accounting Engine,
// the Farmer Payment Made event). Deliberately insert-only: a settlement
// already made is a fact, not something later edited in place.

exports.shorthands = undefined;

const VALID_METHODS = ['cash', 'bank_transfer', 'upi', 'cheque'];

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'money', name: 'farmer_settlement' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      lot_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'commerce', name: 'lot' },
        onDelete: 'RESTRICT',
      },
      farmer_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'trading_partners', name: 'farmer' },
        onDelete: 'RESTRICT',
      },
      amount: { type: 'numeric(12,2)', notNull: true },
      method: { type: 'text', notNull: true },
      notes: { type: 'text' },
      settled_by: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
      settled_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'money', name: 'farmer_settlement' }, 'farmer_settlement_amount_positive', {
    check: 'amount > 0',
  });
  pgm.addConstraint({ schema: 'money', name: 'farmer_settlement' }, 'farmer_settlement_method_valid', {
    check: `method IN (${VALID_METHODS.map((m) => `'${m}'`).join(', ')})`,
  });
  // One settlement per lot — a lot's cost is fixed once at grading
  // (Accounting Engine, LOT.2), and it's paid for once, not incrementally.
  pgm.addConstraint({ schema: 'money', name: 'farmer_settlement' }, 'farmer_settlement_one_per_lot', {
    unique: ['lot_id'],
  });
  pgm.createIndex({ schema: 'money', name: 'farmer_settlement' }, ['tenant_id', 'farmer_id']);
  pgm.sql('ALTER TABLE money.farmer_settlement ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE money.farmer_settlement FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY farmer_settlement_tenant_isolation ON money.farmer_settlement
      USING (tenant_id = current_tenant_id())
  `);
  // Insert + read only — nothing about a recorded settlement is ever edited.
  pgm.sql('REVOKE UPDATE, DELETE ON money.farmer_settlement FROM morbeez_app');
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'money', name: 'farmer_settlement' });
};
