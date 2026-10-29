/* eslint-disable camelcase */

// Owner app redesign, Phase 3 — Delivery orders (docs/redesign): what the
// client's "Delivery Orders" list and "Create Delivery Order" form show.
//
// 1. trading_partners.route: the business's delivery routes ("Mysuru
//    North"), master data like vehicles. Phase 4 adds the stops in order.
// 2. customer: the place shown under their name, a default delivery
//    address, and the route they are usually on.
// 3. customer_order: its number (D-00231, from commerce.document_counter),
//    the delivery plan (date, time, route, driver, vehicle), where to
//    deliver, the credit term agreed for this order, and notes.

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };

exports.up = (pgm) => {
  pgm.createTable({ schema: 'trading_partners', name: 'route' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    name: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'active' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint({ schema: 'trading_partners', name: 'route' }, 'route_valid', {
    check: "status IN ('active', 'archived') AND length(trim(name)) >= 2",
  });
  pgm.sql('CREATE UNIQUE INDEX route_name_unique ON trading_partners.route (tenant_id, lower(trim(name)))');
  pgm.sql('ALTER TABLE trading_partners.route ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE trading_partners.route FORCE ROW LEVEL SECURITY');
  pgm.sql('CREATE POLICY route_tenant_isolation ON trading_partners.route USING (tenant_id = current_tenant_id())');

  pgm.addColumns({ schema: 'trading_partners', name: 'customer' }, {
    place: { type: 'text' },
    address: { type: 'text' },
    route_id: { type: 'uuid', references: { schema: 'trading_partners', name: 'route' }, onDelete: 'RESTRICT' },
  });

  pgm.addColumns({ schema: 'commerce', name: 'customer_order' }, {
    number: { type: 'integer' },
    delivery_date: { type: 'date' },
    delivery_time: { type: 'time' },
    route_id: { type: 'uuid', references: { schema: 'trading_partners', name: 'route' }, onDelete: 'RESTRICT' },
    planned_driver_id: { type: 'uuid', references: { schema: 'trading_partners', name: 'employee' }, onDelete: 'RESTRICT' },
    planned_vehicle_id: { type: 'uuid', references: { schema: 'trading_partners', name: 'vehicle' }, onDelete: 'RESTRICT' },
    delivery_address: { type: 'text' },
    credit_term_days: { type: 'integer' },
    notes: { type: 'text' },
  });
  pgm.addConstraint({ schema: 'commerce', name: 'customer_order' }, 'customer_order_credit_term_valid', {
    check: 'credit_term_days IS NULL OR credit_term_days BETWEEN 0 AND 180',
  });

  // Number the orders that already exist, oldest first, per business.
  // FORCE ROW LEVEL SECURITY would hide every row from a non-superuser
  // owner (RDS, Neon), so it's lifted around the backfill.
  pgm.sql('ALTER TABLE commerce.customer_order NO FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE commerce.document_counter NO FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    UPDATE commerce.customer_order o SET number = n.rn
    FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn FROM commerce.customer_order) n
    WHERE n.id = o.id
  `);
  pgm.sql(`
    INSERT INTO commerce.document_counter (tenant_id, kind, last_number)
    SELECT tenant_id, 'customer_order', max(number) FROM commerce.customer_order GROUP BY tenant_id
    ON CONFLICT (tenant_id, kind) DO UPDATE SET last_number = GREATEST(commerce.document_counter.last_number, EXCLUDED.last_number)
  `);
  pgm.sql('ALTER TABLE commerce.document_counter FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE commerce.customer_order FORCE ROW LEVEL SECURITY');
  pgm.alterColumn({ schema: 'commerce', name: 'customer_order' }, 'number', { notNull: true });
  pgm.addConstraint({ schema: 'commerce', name: 'customer_order' }, 'customer_order_number_unique', { unique: ['tenant_id', 'number'] });
  pgm.createIndex({ schema: 'commerce', name: 'customer_order' }, ['tenant_id', 'delivery_date']);
};

exports.down = (pgm) => {
  pgm.dropIndex({ schema: 'commerce', name: 'customer_order' }, ['tenant_id', 'delivery_date']);
  pgm.dropConstraint({ schema: 'commerce', name: 'customer_order' }, 'customer_order_number_unique');
  pgm.dropConstraint({ schema: 'commerce', name: 'customer_order' }, 'customer_order_credit_term_valid');
  pgm.dropColumns({ schema: 'commerce', name: 'customer_order' }, [
    'number',
    'delivery_date',
    'delivery_time',
    'route_id',
    'planned_driver_id',
    'planned_vehicle_id',
    'delivery_address',
    'credit_term_days',
    'notes',
  ]);
  pgm.dropColumns({ schema: 'trading_partners', name: 'customer' }, ['place', 'address', 'route_id']);
  pgm.dropTable({ schema: 'trading_partners', name: 'route' });
  pgm.sql('ALTER TABLE commerce.document_counter NO FORCE ROW LEVEL SECURITY');
  pgm.sql("DELETE FROM commerce.document_counter WHERE kind = 'customer_order'");
  pgm.sql('ALTER TABLE commerce.document_counter FORCE ROW LEVEL SECURITY');
};
