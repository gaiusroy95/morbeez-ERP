/* eslint-disable camelcase */

// Owner independence (pilot baseline, client Q&A 1 Oct 2026, D–E):
//
// 1. Delegation levels. A driver's authority on the road comes in four
//    levels: 1 delivery + POD, 2 + collection, 3 + procurement, 4 full route
//    operator (expenses and bank deposits included). The owner decides who
//    is eligible and up to which level (employee.delegation_level), and
//    whether that eligibility is a standing permission (authorized on every
//    trip they drive) or needs approving trip by trip (a grant).
//    Eligibility is never authorization by itself.
//
// 2. Grants (fulfilment.delegation): the owner authorizes a driver at a
//    level for one trip (ends with the trip's handover), for the owner's day
//    off (ends at the business's operating-day end), or until a set time.
//    Revoked, never deleted.
//
// 3. Day-off mode: tenant.owner_away_until — the owner is away, a backup
//    driver runs the day, and only exceptions reach the owner at once.
//
// 4. Driver PIN (identity.device_pin): a short PIN for signing in again on
//    the phone the driver registered it on — never on another phone.
//
// 5. Owner alerts (tenant.owner_alert): exceptions, the moment they happen
//    (cash mismatch, customer rejection, procurement problem, a driver who
//    can't go on, a PIN being guessed). Normal activity waits for the
//    evening summary, which is worked out from the day's records.
//
// Existing drivers keep doing what they did: level 4, standing.

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const userColumn = { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };

function isolate(pgm, schema, table) {
  pgm.sql(`ALTER TABLE ${schema}.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE ${schema}.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON ${schema}.${table} USING (tenant_id = current_tenant_id())`);
}

exports.up = (pgm) => {
  // ---- Eligibility ----
  pgm.addColumns({ schema: 'trading_partners', name: 'employee' }, {
    delegation_level: { type: 'smallint' },
    standing_delegation: { type: 'boolean', notNull: true, default: false },
  });
  pgm.addConstraint({ schema: 'trading_partners', name: 'employee' }, 'employee_delegation_level_valid', {
    check: 'delegation_level IS NULL OR delegation_level BETWEEN 1 AND 4',
  });
  pgm.sql(`UPDATE trading_partners.employee SET delegation_level = 4, standing_delegation = true WHERE role_type = 'driver'`);

  // ---- Grants ----
  pgm.createTable({ schema: 'fulfilment', name: 'delegation' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    driver_employee_id: { type: 'uuid', notNull: true, references: { schema: 'trading_partners', name: 'employee' }, onDelete: 'RESTRICT' },
    level: { type: 'smallint', notNull: true },
    kind: { type: 'text', notNull: true },
    trip_id: { type: 'uuid', references: { schema: 'fulfilment', name: 'trip' }, onDelete: 'RESTRICT' },
    ends_at: { type: 'timestamptz' },
    note: { type: 'text' },
    granted_by: { ...userColumn, notNull: true },
    granted_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    revoked_at: { type: 'timestamptz' },
    revoked_by: userColumn,
  });
  pgm.addConstraint({ schema: 'fulfilment', name: 'delegation' }, 'delegation_valid', {
    check: `level BETWEEN 1 AND 4
            AND kind IN ('trip', 'day_off', 'temporary')
            AND (kind = 'trip') = (trip_id IS NOT NULL)
            AND (kind = 'trip' OR ends_at IS NOT NULL)
            AND (revoked_at IS NULL) = (revoked_by IS NULL)`,
  });
  pgm.createIndex({ schema: 'fulfilment', name: 'delegation' }, ['tenant_id', 'driver_employee_id']);
  pgm.createIndex({ schema: 'fulfilment', name: 'delegation' }, 'trip_id', { where: 'trip_id IS NOT NULL' });
  isolate(pgm, 'fulfilment', 'delegation');
  pgm.sql('GRANT SELECT, INSERT ON fulfilment.delegation TO morbeez_app');
  pgm.sql('GRANT UPDATE (revoked_at, revoked_by) ON fulfilment.delegation TO morbeez_app');

  // An expense a driver records beyond their authority waits for the owner's approval at closure.
  pgm.addColumn({ schema: 'fulfilment', name: 'trip_expense' }, {
    needs_approval: { type: 'boolean', notNull: true, default: false },
  });

  // ---- Day-off mode and alert settings ----
  pgm.addColumns({ schema: 'tenant', name: 'tenant' }, {
    // When the business's day ends, in its own timezone: day-off delegations end here.
    operating_day_end: { type: 'time', notNull: true, default: '22:00' },
    owner_away_until: { type: 'timestamptz' },
    // How big a cash or collection difference must be to alert the owner at once.
    alert_cash_threshold: { type: 'numeric(12,2)', notNull: true, default: 500 },
    alert_collection_threshold: { type: 'numeric(12,2)', notNull: true, default: 1000 },
  });

  // ---- Driver PIN ----
  pgm.createTable({ schema: 'identity', name: 'device_pin' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    user_id: { ...userColumn, notNull: true },
    device_id: { type: 'text', notNull: true },
    pin_hash: { type: 'text', notNull: true },
    failed_attempts: { type: 'smallint', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_used_at: { type: 'timestamptz' },
  });
  pgm.addConstraint({ schema: 'identity', name: 'device_pin' }, 'device_pin_one_per_device', { unique: ['user_id', 'device_id'] });
  isolate(pgm, 'identity', 'device_pin');
  pgm.sql('GRANT SELECT, INSERT, UPDATE, DELETE ON identity.device_pin TO morbeez_app');

  // ---- Owner alerts ----
  pgm.createTable({ schema: 'tenant', name: 'owner_alert' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    kind: { type: 'text', notNull: true },
    severity: { type: 'text', notNull: true },
    title: { type: 'text', notNull: true },
    detail: { type: 'text', notNull: true },
    trip_id: { type: 'uuid', references: { schema: 'fulfilment', name: 'trip' }, onDelete: 'RESTRICT' },
    // The same exception raised twice (a retried request) is one alert.
    dedupe_key: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    read_at: { type: 'timestamptz' },
    read_by: userColumn,
  });
  pgm.addConstraint({ schema: 'tenant', name: 'owner_alert' }, 'owner_alert_valid', {
    check: `severity IN ('critical', 'warning')
            AND kind IN ('cash_mismatch', 'collection_discrepancy', 'inventory_mismatch', 'customer_rejection',
                         'procurement_issue', 'driver_unable_to_continue', 'trip_blocked', 'operational_problem', 'security')`,
  });
  pgm.addConstraint({ schema: 'tenant', name: 'owner_alert' }, 'owner_alert_dedupe', { unique: ['tenant_id', 'dedupe_key'] });
  pgm.createIndex({ schema: 'tenant', name: 'owner_alert' }, ['tenant_id', 'created_at']);
  isolate(pgm, 'tenant', 'owner_alert');
  pgm.sql('GRANT SELECT, INSERT ON tenant.owner_alert TO morbeez_app');
  pgm.sql('GRANT UPDATE (read_at, read_by) ON tenant.owner_alert TO morbeez_app');
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'tenant', name: 'owner_alert' });
  pgm.dropTable({ schema: 'identity', name: 'device_pin' });
  pgm.dropColumns({ schema: 'tenant', name: 'tenant' }, ['operating_day_end', 'owner_away_until', 'alert_cash_threshold', 'alert_collection_threshold']);
  pgm.dropColumn({ schema: 'fulfilment', name: 'trip_expense' }, 'needs_approval');
  pgm.dropTable({ schema: 'fulfilment', name: 'delegation' });
  pgm.dropConstraint({ schema: 'trading_partners', name: 'employee' }, 'employee_delegation_level_valid');
  pgm.dropColumns({ schema: 'trading_partners', name: 'employee' }, ['delegation_level', 'standing_delegation']);
};
