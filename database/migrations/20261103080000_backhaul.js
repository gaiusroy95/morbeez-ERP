/* eslint-disable camelcase */

// Driver app V1, Phase D5 — backhaul (docs/redesign/driver-app-v1-plan.md;
// client spec §16–§17, the client's answer 6):
//
// 1. fulfilment.backhaul: a fixed-rent transport job on the way back, after
//    the last delivery — no product, no kilos, no stock. The owner offers it
//    and the driver accepts or skips it (with a reason), or the driver adds
//    one found on the road (accepted as it's added). Then pickup reached →
//    loaded (photo) → drop reached → completed (photo) → paid (cash, UPI or
//    a transfer). Its id may come from the phone, so a job added offline
//    keeps it.
// 2. fulfilment.backhaul_photo: the load, the drop and the payment proof.
//    Insert-only.
// 3. The rent is income ('backhaul_income'); rent paid in cash is with the
//    driver until the handover (trip_reconciliation.backhaul_cash).

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const userColumn = { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };

const BACKHAUL = { schema: 'fulfilment', name: 'backhaul' };
const PHOTO = { schema: 'fulfilment', name: 'backhaul_photo' };
const RECONCILIATION = { schema: 'fulfilment', name: 'trip_reconciliation' };

const STATUSES = ['offered', 'accepted', 'skipped', 'cancelled', 'completed'];
const METHODS = ['cash', 'upi', 'bank_transfer'];
const PHOTO_TYPES = ['load', 'drop', 'payment'];
const list = (xs) => xs.map((x) => `'${x}'`).join(', ');

exports.up = (pgm) => {
  pgm.createTable(BACKHAUL, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    trip_id: { type: 'uuid', notNull: true, references: { schema: 'fulfilment', name: 'trip' }, onDelete: 'RESTRICT' },
    pickup_place: { type: 'text', notNull: true },
    drop_place: { type: 'text', notNull: true },
    rent: { type: 'numeric(12,2)', notNull: true },
    hirer_name: { type: 'text' },
    notes: { type: 'text' },
    offered_by: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'offered' },
    skip_reason: { type: 'text' },
    accepted_at: { type: 'timestamptz' },
    pickup_reached_at: { type: 'timestamptz' },
    loaded_at: { type: 'timestamptz' },
    drop_reached_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
    cancelled_at: { type: 'timestamptz' },
    cancel_reason: { type: 'text' },
    payment_method: { type: 'text' },
    amount_received: { type: 'numeric(12,2)' },
    payment_reference: { type: 'text' },
    payment_note: { type: 'text' },
    paid_at: { type: 'timestamptz' },
    paid_by: userColumn,
    created_by: { ...userColumn, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    version: { type: 'integer', notNull: true, default: 1 },
  });
  pgm.addConstraint(BACKHAUL, 'backhaul_valid', {
    check: `rent > 0 AND length(btrim(pickup_place)) > 0 AND length(btrim(drop_place)) > 0
            AND offered_by IN ('owner', 'driver') AND status IN (${list(STATUSES)})
            AND (status <> 'skipped' OR skip_reason IS NOT NULL)
            AND (status <> 'cancelled' OR cancelled_at IS NOT NULL)
            AND (status NOT IN ('accepted', 'completed') OR accepted_at IS NOT NULL)`,
  });
  // The steps happen in order, and only a completed backhaul is paid — once, in full or less.
  pgm.addConstraint(BACKHAUL, 'backhaul_steps_in_order', {
    check: `(pickup_reached_at IS NULL OR accepted_at IS NOT NULL)
            AND (loaded_at IS NULL OR pickup_reached_at IS NOT NULL)
            AND (drop_reached_at IS NULL OR loaded_at IS NOT NULL)
            AND (completed_at IS NULL OR drop_reached_at IS NOT NULL)
            AND ((status = 'completed') = (completed_at IS NOT NULL))`,
  });
  pgm.addConstraint(BACKHAUL, 'backhaul_payment_valid', {
    check: `(paid_at IS NULL) = (payment_method IS NULL) AND (paid_at IS NULL) = (amount_received IS NULL)
            AND (paid_at IS NULL OR (status = 'completed' AND payment_method IN (${list(METHODS)})
                                     AND amount_received > 0 AND amount_received <= rent))`,
  });
  pgm.createIndex(BACKHAUL, ['tenant_id', 'trip_id']);
  pgm.sql('ALTER TABLE fulfilment.backhaul ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE fulfilment.backhaul FORCE ROW LEVEL SECURITY');
  pgm.sql('CREATE POLICY backhaul_tenant_isolation ON fulfilment.backhaul USING (tenant_id = current_tenant_id())');
  pgm.sql('GRANT SELECT, INSERT, UPDATE ON fulfilment.backhaul TO morbeez_app');
  pgm.sql('REVOKE DELETE ON fulfilment.backhaul FROM morbeez_app');

  pgm.createTable(PHOTO, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    backhaul_id: { type: 'uuid', notNull: true, references: BACKHAUL, onDelete: 'RESTRICT' },
    photo_type: { type: 'text', notNull: true },
    storage_key: { type: 'text', notNull: true },
    content_type: { type: 'text', notNull: true },
    size_bytes: { type: 'integer', notNull: true },
    taken_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    created_by: { ...userColumn, notNull: true },
  });
  pgm.addConstraint(PHOTO, 'backhaul_photo_valid', { check: `photo_type IN (${list(PHOTO_TYPES)}) AND size_bytes > 0` });
  pgm.createIndex(PHOTO, ['backhaul_id', 'photo_type']);
  pgm.sql('ALTER TABLE fulfilment.backhaul_photo ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE fulfilment.backhaul_photo FORCE ROW LEVEL SECURITY');
  pgm.sql('CREATE POLICY backhaul_photo_tenant_isolation ON fulfilment.backhaul_photo USING (tenant_id = current_tenant_id())');
  pgm.sql('GRANT SELECT, INSERT ON fulfilment.backhaul_photo TO morbeez_app');
  pgm.sql('REVOKE UPDATE, DELETE ON fulfilment.backhaul_photo FROM morbeez_app');

  pgm.addColumns(RECONCILIATION, { backhaul_cash: { type: 'numeric(12,2)', notNull: true, default: 0 } });

  pgm.sql(`
    INSERT INTO money.ledger_account (code, name, root_type, number, report_group, is_system, is_control) VALUES
      ('backhaul_income', 'Backhaul income', 'revenue', 4200, 'other_income', true, false)
    ON CONFLICT (code) DO NOTHING
  `);
  pgm.sql('SELECT money.install_chart_of_accounts(id) FROM tenant.tenant');
};

exports.down = (pgm) => {
  pgm.sql("DELETE FROM money.account WHERE code = 'backhaul_income'");
  pgm.sql("DELETE FROM money.ledger_account WHERE code = 'backhaul_income'");
  pgm.dropColumns(RECONCILIATION, ['backhaul_cash']);
  pgm.dropTable(PHOTO);
  pgm.dropTable(BACKHAUL);
};
