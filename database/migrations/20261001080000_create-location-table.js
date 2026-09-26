/* eslint-disable camelcase */

// Domain Model, Inventory bounded context (stock tier). The minimal
// registry Transfers needs to mean anything: a named place stock can sit
// — a warehouse/store area, or a specific vehicle already tracked by
// Workforce/Vehicles (vehicle_id links back to trading_partners.vehicle
// when type = 'vehicle'; null for a plain warehouse location).

exports.shorthands = undefined;

const VALID_TYPES = ['warehouse', 'vehicle', 'other'];
const VALID_STATUSES = ['active', 'archived'];

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'stock', name: 'location' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      name: { type: 'text', notNull: true },
      type: { type: 'text', notNull: true, default: 'warehouse' },
      vehicle_id: {
        type: 'uuid',
        references: { schema: 'trading_partners', name: 'vehicle' },
        onDelete: 'RESTRICT',
      },
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
  pgm.addConstraint({ schema: 'stock', name: 'location' }, 'location_type_valid', {
    check: `type IN (${VALID_TYPES.map((t) => `'${t}'`).join(', ')})`,
  });
  pgm.addConstraint({ schema: 'stock', name: 'location' }, 'location_status_valid', {
    check: `status IN (${VALID_STATUSES.map((s) => `'${s}'`).join(', ')})`,
  });
  pgm.addConstraint({ schema: 'stock', name: 'location' }, 'location_vehicle_iff_type_vehicle', {
    check: "(type = 'vehicle') = (vehicle_id IS NOT NULL)",
  });
  pgm.createIndex({ schema: 'stock', name: 'location' }, ['tenant_id', 'status']);
  pgm.sql('ALTER TABLE stock.location ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE stock.location FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY location_tenant_isolation ON stock.location
      USING (tenant_id = current_tenant_id())
  `);
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'stock', name: 'location' });
};
