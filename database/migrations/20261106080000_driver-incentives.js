/* eslint-disable camelcase */

// Driver app V1, Phase D7 — the incentive engine V1.18
// (docs/redesign/driver-app-v1-plan.md; client spec §24–§25; the client's
// answers 7 and 8: each incentive is an owner-set percentage of its base,
// pay settles weekly):
//
// 1. workforce.driver_incentive_settings / driver_incentive_rule: the owner's
//    rules — for each of the ten incentives, on or off and its percentage —
//    with the mileage target and the night-duty hours. No rule, no incentive.
// 2. workforce.trip_incentive: what a driver earned on a trip, worked out by
//    the backend from the trip's data when the owner closes it — the base,
//    the percentage then in force, the amount and why. Insert-only but for
//    the settlement that pays it.
// 3. The driver says they received a paid settlement (received_at/_by).

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const userColumn = { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };
const t = (name) => ({ schema: 'workforce', name });

const KINDS = ['collection', 'backhaul', 'mileage', 'crates', 'quality', 'new_customer', 'performance', 'night_duty', 'data_quality', 'completion'];
const list = (xs) => xs.map((x) => `'${x}'`).join(', ');

function isolate(pgm, table, updatable) {
  pgm.sql(`ALTER TABLE workforce.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE workforce.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON workforce.${table} USING (tenant_id = current_tenant_id())`);
  pgm.sql(`GRANT SELECT, INSERT ON workforce.${table} TO morbeez_app`);
  if (updatable === '*') pgm.sql(`GRANT UPDATE ON workforce.${table} TO morbeez_app`);
  else if (updatable.length) pgm.sql(`GRANT UPDATE (${updatable.join(', ')}) ON workforce.${table} TO morbeez_app`);
}

exports.up = (pgm) => {
  pgm.createTable(t('driver_incentive_settings'), {
    tenant_id: { ...tenantColumn, primaryKey: true },
    target_km_per_litre: { type: 'numeric(6,2)' },
    night_from: { type: 'time', notNull: true, default: '21:00' },
    night_until: { type: 'time', notNull: true, default: '05:00' },
    version: { type: 'integer', notNull: true, default: 1 },
    updated_by: userColumn,
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('driver_incentive_settings'), 'driver_incentive_settings_valid', {
    check: 'target_km_per_litre IS NULL OR target_km_per_litre > 0',
  });
  isolate(pgm, 'driver_incentive_settings', '*');

  pgm.createTable(t('driver_incentive_rule'), {
    tenant_id: { ...tenantColumn, primaryKey: true },
    kind: { type: 'text', primaryKey: true },
    enabled: { type: 'boolean', notNull: true },
    percent: { type: 'numeric(7,3)', notNull: true },
  });
  pgm.addConstraint(t('driver_incentive_rule'), 'driver_incentive_rule_valid', {
    check: `kind IN (${list(KINDS)}) AND percent >= 0 AND percent <= 100`,
  });
  isolate(pgm, 'driver_incentive_rule', '*');

  pgm.createTable(t('trip_incentive'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    trip_id: { type: 'uuid', notNull: true, references: { schema: 'fulfilment', name: 'trip' }, onDelete: 'RESTRICT' },
    employee_id: { type: 'uuid', notNull: true, references: { schema: 'trading_partners', name: 'employee' }, onDelete: 'RESTRICT' },
    kind: { type: 'text', notNull: true },
    base: { type: 'numeric(14,2)', notNull: true },
    percent: { type: 'numeric(7,3)', notNull: true },
    amount: { type: 'numeric(12,2)', notNull: true },
    detail: { type: 'text', notNull: true },
    work_date: { type: 'date', notNull: true },
    settlement_id: { type: 'uuid', references: t('settlement'), onDelete: 'RESTRICT' },
    created_by: { ...userColumn, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('trip_incentive'), 'trip_incentive_valid', {
    check: `kind IN (${list(KINDS)}) AND base >= 0 AND percent >= 0 AND percent <= 100 AND amount >= 0`,
  });
  pgm.addConstraint(t('trip_incentive'), 'trip_incentive_once', { unique: ['trip_id', 'employee_id', 'kind'] });
  pgm.createIndex(t('trip_incentive'), ['employee_id', 'work_date']);
  isolate(pgm, 'trip_incentive', ['settlement_id']);

  pgm.addColumns(t('settlement'), { received_at: { type: 'timestamptz' }, received_by: userColumn });
  pgm.addConstraint(t('settlement'), 'settlement_received_valid', {
    check: '(received_at IS NULL) = (received_by IS NULL) AND (received_at IS NULL OR paid_at IS NOT NULL)',
  });
  pgm.sql('GRANT UPDATE (received_at, received_by) ON workforce.settlement TO morbeez_app');
};

exports.down = (pgm) => {
  pgm.sql('REVOKE UPDATE (received_at, received_by) ON workforce.settlement FROM morbeez_app');
  pgm.dropConstraint(t('settlement'), 'settlement_received_valid');
  pgm.dropColumns(t('settlement'), ['received_at', 'received_by']);
  pgm.dropTable(t('trip_incentive'));
  pgm.dropTable(t('driver_incentive_rule'));
  pgm.dropTable(t('driver_incentive_settings'));
};
