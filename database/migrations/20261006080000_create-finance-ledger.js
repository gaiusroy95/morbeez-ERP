/* eslint-disable camelcase */

// Finance's single append-only, double-entry ledger (Constitution III.3;
// Accounting Engine, DE.1-DE.4). Three tables:
//
//   money.ledger_account — the chart of accounts. Global, not per tenant:
//     every tenant posts to the same fixed set, each with exactly one root
//     type (DE.2). 'finance_costs' is an addition to the Accounting
//     Engine's chart — bank charges, interest, and payment fees had no home.
//   money.ledger_entry   — one business event's posting, traced to the row
//     that caused it (source_type/source_id — DE.3; there is no event bus
//     yet to carry an event_id). At most one entry per (entry_type,
//     source) so a retried call can never post twice.
//   money.ledger_line    — the debit/credit lines. customer/farmer party
//     columns make AR and AP sub-ledgers queryable straight off the ledger.
//
// Balance is enforced by the database, not only by the service: deferred
// constraint triggers reject, at COMMIT, any entry whose lines don't sum
// to zero or that has fewer than two lines (DE.1 — a half-posted entry is
// never observable). Insert + read only for the app role; a correction is
// a new, reversing entry (DE.4).

exports.shorthands = undefined;

const ROOT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

// [code, name, root type]
const ACCOUNTS = [
  ['cash_on_hand', 'Cash on hand', 'asset'],
  ['bank', 'Bank', 'asset'],
  ['accounts_receivable', 'Accounts receivable', 'asset'],
  ['inventory_asset', 'Inventory asset', 'asset'],
  ['farmer_advance', 'Farmer advances', 'asset'],
  ['accounts_payable_farmer', 'Accounts payable — farmers', 'liability'],
  ['revenue_sales', 'Revenue — product sales', 'revenue'],
  ['finance_charge_income', 'Finance charge income', 'revenue'],
  ['cost_of_goods_sold', 'Cost of goods sold', 'expense'],
  ['finance_costs', 'Finance costs — bank charges, interest, payment fees', 'expense'],
];

const PARTY_TYPES = ['customer', 'farmer'];

// Constants from this file, never user input.
const literal = (value) => `'${value.replace(/'/g, "''")}'`;

const tenantIsolated = (pgm, table) => {
  pgm.sql(`ALTER TABLE money.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE money.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON money.${table} USING (tenant_id = current_tenant_id())`);
};

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'money', name: 'ledger_account' },
    {
      code: { type: 'text', primaryKey: true },
      name: { type: 'text', notNull: true },
      root_type: { type: 'text', notNull: true },
    },
  );
  pgm.addConstraint({ schema: 'money', name: 'ledger_account' }, 'ledger_account_root_type_valid', {
    check: `root_type IN (${ROOT_TYPES.map(literal).join(', ')})`,
  });
  pgm.sql(
    `INSERT INTO money.ledger_account (code, name, root_type) VALUES ${ACCOUNTS.map(
      ([code, name, root]) => `(${literal(code)}, ${literal(name)}, ${literal(root)})`,
    ).join(', ')}`,
  );
  // The chart is reference data a migration changes, never the app.
  pgm.sql('REVOKE INSERT, UPDATE, DELETE ON money.ledger_account FROM morbeez_app');

  pgm.createTable(
    { schema: 'money', name: 'ledger_entry' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' },
      entry_type: { type: 'text', notNull: true },
      source_type: { type: 'text', notNull: true },
      source_id: { type: 'uuid', notNull: true },
      occurred_at: { type: 'timestamptz', notNull: true },
      memo: { type: 'text' },
      reverses_entry_id: {
        type: 'uuid',
        references: { schema: 'money', name: 'ledger_entry' },
        onDelete: 'RESTRICT',
      },
      created_by: { type: 'uuid', notNull: true, references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'money', name: 'ledger_entry' }, 'ledger_entry_one_per_source', {
    unique: ['tenant_id', 'entry_type', 'source_id'],
  });
  pgm.addConstraint({ schema: 'money', name: 'ledger_entry' }, 'ledger_entry_reversed_once', {
    unique: ['reverses_entry_id'],
  });
  pgm.createIndex({ schema: 'money', name: 'ledger_entry' }, ['tenant_id', 'occurred_at']);
  tenantIsolated(pgm, 'ledger_entry');

  pgm.createTable(
    { schema: 'money', name: 'ledger_line' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' },
      entry_id: { type: 'uuid', notNull: true, references: { schema: 'money', name: 'ledger_entry' }, onDelete: 'RESTRICT' },
      account_code: { type: 'text', notNull: true, references: { schema: 'money', name: 'ledger_account' }, onDelete: 'RESTRICT' },
      party_type: { type: 'text' },
      party_id: { type: 'uuid' },
      debit: { type: 'numeric(14,2)', notNull: true, default: 0 },
      credit: { type: 'numeric(14,2)', notNull: true, default: 0 },
    },
  );
  pgm.addConstraint({ schema: 'money', name: 'ledger_line' }, 'ledger_line_one_side', {
    check: 'debit >= 0 AND credit >= 0 AND (debit > 0) <> (credit > 0)',
  });
  pgm.addConstraint({ schema: 'money', name: 'ledger_line' }, 'ledger_line_party_valid', {
    check: `(party_type IS NULL) = (party_id IS NULL) AND (party_type IS NULL OR party_type IN (${PARTY_TYPES.map(literal).join(', ')}))`,
  });
  pgm.createIndex({ schema: 'money', name: 'ledger_line' }, 'entry_id');
  pgm.createIndex({ schema: 'money', name: 'ledger_line' }, ['tenant_id', 'account_code']);
  pgm.createIndex({ schema: 'money', name: 'ledger_line' }, ['tenant_id', 'party_type', 'party_id']);
  tenantIsolated(pgm, 'ledger_line');

  // DE.1, enforced at COMMIT. Runs as the invoking role, so RLS scopes the
  // sums to the posting tenant's own rows.
  pgm.sql(`
    CREATE FUNCTION money.assert_ledger_entry_balanced() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      checked_entry uuid;
      line_count int;
      total_debit numeric;
      total_credit numeric;
    BEGIN
      -- An IF, not a CASE: PL/pgSQL resolves every field a CASE mentions,
      -- and a ledger_entry row has no entry_id.
      IF TG_TABLE_NAME = 'ledger_entry' THEN
        checked_entry := NEW.id;
      ELSE
        checked_entry := NEW.entry_id;
      END IF;
      SELECT count(*), COALESCE(sum(debit), 0), COALESCE(sum(credit), 0)
        INTO line_count, total_debit, total_credit
        FROM money.ledger_line WHERE entry_id = checked_entry;
      IF line_count < 2 THEN
        RAISE EXCEPTION 'Ledger entry % has % line(s); a double entry needs at least two', checked_entry, line_count
          USING ERRCODE = 'check_violation';
      END IF;
      IF total_debit <> total_credit THEN
        RAISE EXCEPTION 'Ledger entry % does not balance: debits %, credits %', checked_entry, total_debit, total_credit
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NULL;
    END;
    $$
  `);
  pgm.sql(`
    CREATE CONSTRAINT TRIGGER ledger_entry_balanced
      AFTER INSERT ON money.ledger_entry
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION money.assert_ledger_entry_balanced()
  `);
  pgm.sql(`
    CREATE CONSTRAINT TRIGGER ledger_line_balanced
      AFTER INSERT ON money.ledger_line
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION money.assert_ledger_entry_balanced()
  `);
  pgm.sql('GRANT EXECUTE ON FUNCTION money.assert_ledger_entry_balanced() TO morbeez_app');

  pgm.sql('REVOKE UPDATE, DELETE ON money.ledger_entry FROM morbeez_app');
  pgm.sql('REVOKE UPDATE, DELETE ON money.ledger_line FROM morbeez_app');
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'money', name: 'ledger_line' });
  pgm.dropTable({ schema: 'money', name: 'ledger_entry' });
  pgm.sql('DROP FUNCTION money.assert_ledger_entry_balanced()');
  pgm.dropTable({ schema: 'money', name: 'ledger_account' });
};
