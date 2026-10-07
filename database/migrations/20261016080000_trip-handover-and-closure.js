/* eslint-disable camelcase */

// Driver money handover and owner trip closure (pilot baseline, client Q&A
// 30 Sep / 1 Oct 2026).
//
// 1. Cash a driver collects at a delivery stays with the driver until it's
//    handed over: it now lands in the trip's cash float (cash_with_drivers)
//    instead of the owner's cash on hand. into_driver_float marks which
//    collections did, so trips recorded before this keep reconciling as
//    they were (their cash already went to cash on hand).
//
// 2. A driver may deposit cash straight into a bank account on the road
//    (fulfilment.trip_cash_deposit): it leaves the float for the bank.
//
// 3. The trip lifecycle gains the owner's side: the driver submits
//    ('completed', with the cash they say they're handing over), the owner
//    can put it on hold ('on_hold') or send it back ('in_progress' again,
//    with a note), and only the owner closes it ('reconciled').
//
// 4. A closure records what was checked and how it ended: 'pass', or
//    'approved_exception' with the owner's reason.
//
// Expected handover = advance + cash collections + spot-sale cash
//                     − expenses − bank deposits.

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE fulfilment.trip DROP CONSTRAINT trip_status_valid');
  pgm.sql(`ALTER TABLE fulfilment.trip ADD CONSTRAINT trip_status_valid
    CHECK (status IN ('planned', 'in_progress', 'completed', 'on_hold', 'cancelled', 'reconciled'))`);
  pgm.addColumns({ schema: 'fulfilment', name: 'trip' }, {
    submitted_by: { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' },
    cash_declared: { type: 'numeric(12,2)' },
    submit_note: { type: 'text' },
    // The owner's last word before closing: why it's on hold, or what the driver must fix.
    review_note: { type: 'text' },
  });
  pgm.addConstraint({ schema: 'fulfilment', name: 'trip' }, 'trip_cash_declared_nonnegative', {
    check: 'cash_declared IS NULL OR cash_declared >= 0',
  });

  pgm.addColumn({ schema: 'money', name: 'customer_collection' }, {
    into_driver_float: { type: 'boolean', notNull: true, default: false },
  });

  pgm.createTable(
    { schema: 'fulfilment', name: 'trip_cash_deposit' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' },
      trip_id: { type: 'uuid', notNull: true, references: { schema: 'fulfilment', name: 'trip' }, onDelete: 'RESTRICT' },
      amount: { type: 'numeric(12,2)', notNull: true },
      bank_account: { type: 'text', notNull: true },
      reference: { type: 'text', notNull: true },
      deposited_at: { type: 'timestamptz', notNull: true },
      recorded_by: { type: 'uuid', notNull: true, references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' },
      recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      client_ref: { type: 'uuid' },
    },
  );
  pgm.addConstraint({ schema: 'fulfilment', name: 'trip_cash_deposit' }, 'trip_cash_deposit_amount_positive', {
    check: 'amount > 0',
  });
  pgm.createIndex({ schema: 'fulfilment', name: 'trip_cash_deposit' }, ['tenant_id', 'trip_id']);
  pgm.createIndex({ schema: 'fulfilment', name: 'trip_cash_deposit' }, 'client_ref', {
    name: 'trip_cash_deposit_client_ref_unique',
    unique: true,
    where: 'client_ref IS NOT NULL',
  });
  pgm.sql('ALTER TABLE fulfilment.trip_cash_deposit ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE fulfilment.trip_cash_deposit FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY trip_cash_deposit_tenant_isolation ON fulfilment.trip_cash_deposit
      USING (tenant_id = current_tenant_id())
  `);
  // Insert + read only, like every record of cash that moved.
  pgm.sql('REVOKE UPDATE, DELETE ON fulfilment.trip_cash_deposit FROM morbeez_app');

  pgm.addColumns({ schema: 'fulfilment', name: 'trip_reconciliation' }, {
    cash_collections: { type: 'numeric(12,2)', notNull: true, default: 0 },
    cash_deposited: { type: 'numeric(12,2)', notNull: true, default: 0 },
    direct_payments: { type: 'numeric(12,2)', notNull: true, default: 0 },
    cash_declared: { type: 'numeric(12,2)' },
    outcome: { type: 'text', notNull: true, default: 'pass' },
    exception_note: { type: 'text' },
    checklist: { type: 'jsonb' },
  });
  pgm.addConstraint({ schema: 'fulfilment', name: 'trip_reconciliation' }, 'trip_reconciliation_outcome_valid', {
    check: `outcome IN ('pass', 'approved_exception') AND (outcome = 'pass' OR exception_note IS NOT NULL)`,
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint({ schema: 'fulfilment', name: 'trip_reconciliation' }, 'trip_reconciliation_outcome_valid');
  pgm.dropColumns({ schema: 'fulfilment', name: 'trip_reconciliation' }, [
    'cash_collections', 'cash_deposited', 'direct_payments', 'cash_declared', 'outcome', 'exception_note', 'checklist',
  ]);
  pgm.dropTable({ schema: 'fulfilment', name: 'trip_cash_deposit' });
  pgm.dropColumn({ schema: 'money', name: 'customer_collection' }, 'into_driver_float');
  pgm.dropConstraint({ schema: 'fulfilment', name: 'trip' }, 'trip_cash_declared_nonnegative');
  pgm.dropColumns({ schema: 'fulfilment', name: 'trip' }, ['submitted_by', 'cash_declared', 'submit_note', 'review_note']);
  // Refuses while any trip is on hold — release or close those first.
  pgm.sql('ALTER TABLE fulfilment.trip DROP CONSTRAINT trip_status_valid');
  pgm.sql(`ALTER TABLE fulfilment.trip ADD CONSTRAINT trip_status_valid
    CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled', 'reconciled'))`);
};
