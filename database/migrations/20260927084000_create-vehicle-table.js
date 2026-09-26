/* eslint-disable camelcase */

// Domain Model, Trading Partners & Catalog tier: the fleet. Financial
// treatment (depreciation, disposal gain/loss — Accounting Engine,
// VEH.1-VEH.5) is Accounting's concern, not implemented here; this table
// only tracks operational existence and roadworthiness, per the Domain
// Model's Vehicles/Accounting split.

exports.shorthands = undefined;

const VALID_FUEL_TYPES = ['diesel', 'petrol', 'cng', 'electric'];
const VALID_STATUSES = ['active', 'maintenance', 'disposed'];

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'trading_partners', name: 'vehicle' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      registration_number: { type: 'text', notNull: true },
      capacity_kg: { type: 'numeric(10,2)', notNull: true },
      fuel_type: { type: 'text', notNull: true },
      acquisition_cost: { type: 'numeric(12,2)' },
      acquisition_date: { type: 'date' },
      status: { type: 'text', notNull: true, default: 'active' },
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

  pgm.addConstraint({ schema: 'trading_partners', name: 'vehicle' }, 'vehicle_tenant_registration_unique', {
    unique: ['tenant_id', 'registration_number'],
  });
  pgm.addConstraint({ schema: 'trading_partners', name: 'vehicle' }, 'vehicle_capacity_positive', {
    check: 'capacity_kg > 0',
  });
  pgm.addConstraint({ schema: 'trading_partners', name: 'vehicle' }, 'vehicle_fuel_type_valid', {
    check: `fuel_type IN (${VALID_FUEL_TYPES.map((v) => `'${v}'`).join(', ')})`,
  });
  pgm.addConstraint({ schema: 'trading_partners', name: 'vehicle' }, 'vehicle_status_valid', {
    check: `status IN (${VALID_STATUSES.map((v) => `'${v}'`).join(', ')})`,
  });

  pgm.createIndex({ schema: 'trading_partners', name: 'vehicle' }, ['tenant_id', 'status']);
  pgm.sql('ALTER TABLE trading_partners.vehicle ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE trading_partners.vehicle FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY vehicle_tenant_isolation ON trading_partners.vehicle
      USING (tenant_id = current_tenant_id())
  `);
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'trading_partners', name: 'vehicle' });
};
