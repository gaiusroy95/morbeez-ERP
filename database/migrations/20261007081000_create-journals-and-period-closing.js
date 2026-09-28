/* eslint-disable camelcase */

// Accounting's own records over Finance's ledger:
//
//   money.manual_journal — a journal entry a person posts (opening balances,
//     rent, salaries, owner's capital, depreciation…). The header carries a
//     per-tenant running number and the business date; its lines live in
//     the ledger like every other entry (entry_type 'manual_journal',
//     source_id = this row — DE.3's traceable cause).
//   money.period_close   — closing the books through a date: the period's
//     revenue and expense balances are moved to retained earnings by one
//     ledger entry, and nothing may be posted on or before that date
//     afterwards. Reopening reverses the closing entry (DE.4) and lifts the
//     lock back to the previous close.
//
// The lock is enforced by the database, not only the service: every path
// that posts (payments, deliveries, grading, journals…) is covered, however
// it was reached. A backdated payment into a closed month is refused.

exports.shorthands = undefined;

const PERMISSIONS = [
  ['accounting:read', 'View the chart of accounts, journals, general ledger, trial balance, and financial statements'],
  ['accounting:post', 'Post and reverse manual journal entries'],
  ['accounting:manage', 'Add, rename, renumber, and retire accounts in the chart of accounts'],
  ['accounting:close', 'Close an accounting period, and reopen the most recent one'],
];

const literal = (value) => `'${value.replace(/'/g, "''")}'`;

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'money', name: 'manual_journal' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' },
      journal_number: { type: 'integer', notNull: true },
      entry_date: { type: 'date', notNull: true },
      reference: { type: 'text' },
      memo: { type: 'text', notNull: true },
      created_by: { type: 'uuid', notNull: true, references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'money', name: 'manual_journal' }, 'manual_journal_number_unique', {
    unique: ['tenant_id', 'journal_number'],
  });
  pgm.addConstraint({ schema: 'money', name: 'manual_journal' }, 'manual_journal_memo_present', {
    check: 'length(btrim(memo)) >= 3',
  });

  pgm.createTable(
    { schema: 'money', name: 'period_close' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' },
      period_start: { type: 'date' }, // null = from the beginning of the books
      period_end: { type: 'date', notNull: true },
      net_income: { type: 'numeric(14,2)', notNull: true },
      closing_entry_id: { type: 'uuid', references: { schema: 'money', name: 'ledger_entry' }, onDelete: 'RESTRICT' },
      notes: { type: 'text' },
      closed_by: { type: 'uuid', notNull: true, references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' },
      closed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      reopened_by: { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' },
      reopened_at: { type: 'timestamptz' },
      reopen_reason: { type: 'text' },
      reopen_entry_id: { type: 'uuid', references: { schema: 'money', name: 'ledger_entry' }, onDelete: 'RESTRICT' },
    },
  );
  const close = { schema: 'money', name: 'period_close' };
  pgm.addConstraint(close, 'period_close_dates_ordered', { check: 'period_start IS NULL OR period_start <= period_end' });
  pgm.addConstraint(close, 'period_close_reopen_complete', {
    check: '(reopened_at IS NULL) = (reopened_by IS NULL) AND (reopened_at IS NULL) = (reopen_reason IS NULL)',
  });
  // At most one live close per end date; a reopened one stays as history.
  pgm.sql(
    'CREATE UNIQUE INDEX period_close_one_live_per_end ON money.period_close (tenant_id, period_end) WHERE reopened_at IS NULL',
  );

  for (const table of ['manual_journal', 'period_close']) {
    pgm.sql(`ALTER TABLE money.${table} ENABLE ROW LEVEL SECURITY`);
    pgm.sql(`ALTER TABLE money.${table} FORCE ROW LEVEL SECURITY`);
    pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON money.${table} USING (tenant_id = current_tenant_id())`);
  }
  pgm.sql('REVOKE UPDATE, DELETE ON money.manual_journal FROM morbeez_app');
  // A close is only ever updated to record its reopening.
  pgm.sql('REVOKE UPDATE, DELETE ON money.period_close FROM morbeez_app');
  pgm.sql(
    'GRANT UPDATE (reopened_by, reopened_at, reopen_reason, reopen_entry_id) ON money.period_close TO morbeez_app',
  );

  // The lock. The closed-through date is the latest live close's end; an
  // entry whose business date (tenant-local) falls on or before it is
  // refused — except the closing and reopening entries themselves, which
  // are dated inside the period by design. SQLSTATE MZ001 lets the API
  // answer 409 with this message instead of a generic 500.
  pgm.sql(`
    CREATE FUNCTION money.assert_period_open() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      locked_through date;
      tz text;
      entry_date date;
    BEGIN
      IF NEW.entry_type IN ('period_close', 'period_reopen') THEN
        RETURN NEW;
      END IF;
      SELECT max(period_end) INTO locked_through
        FROM money.period_close WHERE tenant_id = NEW.tenant_id AND reopened_at IS NULL;
      IF locked_through IS NULL THEN
        RETURN NEW;
      END IF;
      SELECT timezone INTO tz FROM tenant.tenant WHERE id = NEW.tenant_id;
      entry_date := (NEW.occurred_at AT TIME ZONE COALESCE(tz, 'UTC'))::date;
      IF entry_date <= locked_through THEN
        RAISE EXCEPTION 'The books are closed through %; nothing can be posted dated % or earlier. Date it after %, or reopen the period first.',
          to_char(locked_through, 'DD Mon YYYY'), to_char(locked_through, 'DD Mon YYYY'), to_char(locked_through, 'DD Mon YYYY')
          USING ERRCODE = 'MZ001';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  pgm.sql(`
    CREATE TRIGGER ledger_entry_period_open BEFORE INSERT ON money.ledger_entry
      FOR EACH ROW EXECUTE FUNCTION money.assert_period_open()
  `);
  pgm.sql('GRANT EXECUTE ON FUNCTION money.assert_period_open() TO morbeez_app');

  pgm.createIndex({ schema: 'money', name: 'ledger_entry' }, ['tenant_id', 'entry_type']);

  const rows = PERMISSIONS.map(([code, description]) => `(${literal(code)}, ${literal(description)})`);
  pgm.sql(
    `INSERT INTO identity.permission (code, description) VALUES ${rows.join(', ')}
     ON CONFLICT (code) DO NOTHING`,
  );
};

exports.down = (pgm) => {
  const codes = PERMISSIONS.map(([code]) => literal(code));
  pgm.sql(`DELETE FROM identity.permission WHERE code IN (${codes.join(', ')})`);
  pgm.dropIndex({ schema: 'money', name: 'ledger_entry' }, ['tenant_id', 'entry_type']);
  pgm.sql('DROP TRIGGER ledger_entry_period_open ON money.ledger_entry');
  pgm.sql('DROP FUNCTION money.assert_period_open()');
  pgm.dropTable({ schema: 'money', name: 'period_close' });
  pgm.dropTable({ schema: 'money', name: 'manual_journal' });
};
