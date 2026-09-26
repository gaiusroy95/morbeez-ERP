/* eslint-disable camelcase */

// Domain Model, Logistics bounded context (fulfilment tier). A Trip is
// one vehicle+driver run covering one or more Stops — farmer pickups
// and/or customer deliveries, in order (the Route). advance_amount is the
// cash float handed to the driver before departure; Reconciliation closes
// it out against recorded expenses at the end.

exports.shorthands = undefined;

const VALID_STATUSES = ['planned', 'in_progress', 'completed', 'cancelled', 'reconciled'];

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'fulfilment', name: 'trip' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      vehicle_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'trading_partners', name: 'vehicle' },
        onDelete: 'RESTRICT',
      },
      driver_employee_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'trading_partners', name: 'employee' },
        onDelete: 'RESTRICT',
      },
      status: { type: 'text', notNull: true, default: 'planned' },
      planned_date: { type: 'date' },
      advance_amount: { type: 'numeric(12,2)', notNull: true, default: 0 },
      started_at: { type: 'timestamptz' },
      completed_at: { type: 'timestamptz' },
      version: { type: 'integer', notNull: true, default: 1 },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      created_by: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
    },
  );
  pgm.addConstraint({ schema: 'fulfilment', name: 'trip' }, 'trip_status_valid', {
    check: `status IN (${VALID_STATUSES.map((s) => `'${s}'`).join(', ')})`,
  });
  pgm.addConstraint({ schema: 'fulfilment', name: 'trip' }, 'trip_advance_amount_nonnegative', {
    check: 'advance_amount >= 0',
  });
  pgm.createIndex({ schema: 'fulfilment', name: 'trip' }, ['tenant_id', 'status']);
  pgm.createIndex({ schema: 'fulfilment', name: 'trip' }, ['tenant_id', 'vehicle_id']);
  pgm.createIndex({ schema: 'fulfilment', name: 'trip' }, ['tenant_id', 'driver_employee_id']);
  pgm.sql('ALTER TABLE fulfilment.trip ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE fulfilment.trip FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY trip_tenant_isolation ON fulfilment.trip
      USING (tenant_id = current_tenant_id())
  `);
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'fulfilment', name: 'trip' });
};
