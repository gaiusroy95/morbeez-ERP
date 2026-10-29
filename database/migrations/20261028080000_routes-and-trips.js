/* eslint-disable camelcase */

// Owner app redesign, Phase 4 — Routes and Trips (docs/redesign).
//
// 1. trading_partners.route_stop: the customers and farmers on each route,
//    in the order the vehicle visits them. A party is on one route at most.
//    It replaces customer.route_id (Phase 3): a customer's usual route is
//    the route they're a stop on.
// 2. trip: its number (T-20261028-001, a running number per business per
//    day, from commerce.document_counter under 'trip:<day>'), the route it
//    runs, and its crew — a packer and a loader beside the driver.
// 3. trip_reconciliation.closing_stock: what was counted on the vehicle at
//    closing, against what should have been there, product by product.

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };

exports.up = (pgm) => {
  pgm.createTable({ schema: 'trading_partners', name: 'route_stop' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    route_id: { type: 'uuid', notNull: true, references: { schema: 'trading_partners', name: 'route' }, onDelete: 'CASCADE' },
    position: { type: 'integer', notNull: true },
    customer_id: { type: 'uuid', references: { schema: 'trading_partners', name: 'customer' }, onDelete: 'CASCADE' },
    farmer_id: { type: 'uuid', references: { schema: 'trading_partners', name: 'farmer' }, onDelete: 'CASCADE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint({ schema: 'trading_partners', name: 'route_stop' }, 'route_stop_one_party', {
    check: '(customer_id IS NULL) <> (farmer_id IS NULL) AND position > 0',
  });
  pgm.addConstraint({ schema: 'trading_partners', name: 'route_stop' }, 'route_stop_customer_once', { unique: ['customer_id'] });
  pgm.addConstraint({ schema: 'trading_partners', name: 'route_stop' }, 'route_stop_farmer_once', { unique: ['farmer_id'] });
  pgm.createIndex({ schema: 'trading_partners', name: 'route_stop' }, ['route_id', 'position']);
  pgm.sql('ALTER TABLE trading_partners.route_stop ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE trading_partners.route_stop FORCE ROW LEVEL SECURITY');
  pgm.sql('CREATE POLICY route_stop_tenant_isolation ON trading_partners.route_stop USING (tenant_id = current_tenant_id())');

  // Customers already on a route (Phase 3) become its stops, by name.
  // FORCE ROW LEVEL SECURITY would hide every row from a non-superuser
  // owner (RDS, Neon), so it's lifted around the backfills.
  pgm.sql('ALTER TABLE trading_partners.customer NO FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE trading_partners.route_stop NO FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    INSERT INTO trading_partners.route_stop (tenant_id, route_id, position, customer_id)
    SELECT tenant_id, route_id, row_number() OVER (PARTITION BY route_id ORDER BY name, id), id
    FROM trading_partners.customer WHERE route_id IS NOT NULL
  `);
  pgm.sql('ALTER TABLE trading_partners.route_stop FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE trading_partners.customer FORCE ROW LEVEL SECURITY');
  pgm.dropColumns({ schema: 'trading_partners', name: 'customer' }, ['route_id']);

  // Trip numbers count per day, so the counter's kind carries the day.
  pgm.dropConstraint({ schema: 'commerce', name: 'document_counter' }, 'document_counter_kind_valid');
  pgm.addConstraint({ schema: 'commerce', name: 'document_counter' }, 'document_counter_kind_valid', {
    check: "kind IN ('purchase_order', 'customer_order', 'trip') OR kind ~ '^trip:[0-9]{4}-[0-9]{2}-[0-9]{2}$'",
  });

  pgm.addColumns({ schema: 'fulfilment', name: 'trip' }, {
    number: { type: 'text' },
    route_id: { type: 'uuid', references: { schema: 'trading_partners', name: 'route' }, onDelete: 'RESTRICT' },
    packer_employee_id: { type: 'uuid', references: { schema: 'trading_partners', name: 'employee' }, onDelete: 'RESTRICT' },
    loader_employee_id: { type: 'uuid', references: { schema: 'trading_partners', name: 'employee' }, onDelete: 'RESTRICT' },
  });
  pgm.sql('ALTER TABLE fulfilment.trip NO FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE commerce.document_counter NO FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    WITH days AS (
      SELECT t.id, t.tenant_id, COALESCE(t.planned_date, (t.created_at AT TIME ZONE tn.timezone)::date) AS day, t.created_at
      FROM fulfilment.trip t JOIN tenant.tenant tn ON tn.id = t.tenant_id
    ), numbered AS (
      SELECT id, tenant_id, day, row_number() OVER (PARTITION BY tenant_id, day ORDER BY created_at, id) AS n FROM days
    )
    UPDATE fulfilment.trip t SET number = 'T-' || to_char(n.day, 'YYYYMMDD') || '-' || lpad(n.n::text, 3, '0')
    FROM numbered n WHERE n.id = t.id
  `);
  pgm.sql(`
    INSERT INTO commerce.document_counter (tenant_id, kind, last_number)
    SELECT tenant_id, 'trip:' || substr(number, 3, 4) || '-' || substr(number, 7, 2) || '-' || substr(number, 9, 2), max(substr(number, 12)::int)
    FROM fulfilment.trip GROUP BY 1, 2
  `);
  pgm.sql('ALTER TABLE commerce.document_counter FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE fulfilment.trip FORCE ROW LEVEL SECURITY');
  pgm.alterColumn({ schema: 'fulfilment', name: 'trip' }, 'number', { notNull: true });
  pgm.addConstraint({ schema: 'fulfilment', name: 'trip' }, 'trip_number_unique', { unique: ['tenant_id', 'number'] });
  pgm.addConstraint({ schema: 'fulfilment', name: 'trip' }, 'trip_crew_distinct', {
    check:
      '(packer_employee_id IS NULL OR packer_employee_id <> driver_employee_id) AND ' +
      '(loader_employee_id IS NULL OR loader_employee_id <> driver_employee_id)',
  });
  pgm.createIndex({ schema: 'fulfilment', name: 'trip' }, ['tenant_id', 'planned_date']);

  pgm.addColumns({ schema: 'fulfilment', name: 'trip_reconciliation' }, { closing_stock: { type: 'jsonb' } });
};

exports.down = (pgm) => {
  pgm.dropColumns({ schema: 'fulfilment', name: 'trip_reconciliation' }, ['closing_stock']);
  pgm.dropIndex({ schema: 'fulfilment', name: 'trip' }, ['tenant_id', 'planned_date']);
  pgm.dropConstraint({ schema: 'fulfilment', name: 'trip' }, 'trip_crew_distinct');
  pgm.dropConstraint({ schema: 'fulfilment', name: 'trip' }, 'trip_number_unique');
  pgm.dropColumns({ schema: 'fulfilment', name: 'trip' }, ['number', 'route_id', 'packer_employee_id', 'loader_employee_id']);
  pgm.sql('ALTER TABLE commerce.document_counter NO FORCE ROW LEVEL SECURITY');
  pgm.sql("DELETE FROM commerce.document_counter WHERE kind LIKE 'trip:%'");
  pgm.sql('ALTER TABLE commerce.document_counter FORCE ROW LEVEL SECURITY');
  pgm.dropConstraint({ schema: 'commerce', name: 'document_counter' }, 'document_counter_kind_valid');
  pgm.addConstraint({ schema: 'commerce', name: 'document_counter' }, 'document_counter_kind_valid', {
    check: "kind IN ('purchase_order', 'customer_order', 'trip')",
  });
  pgm.addColumns({ schema: 'trading_partners', name: 'customer' }, {
    route_id: { type: 'uuid', references: { schema: 'trading_partners', name: 'route' }, onDelete: 'RESTRICT' },
  });
  pgm.sql('ALTER TABLE trading_partners.customer NO FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE trading_partners.route_stop NO FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    UPDATE trading_partners.customer c SET route_id = s.route_id
    FROM trading_partners.route_stop s WHERE s.customer_id = c.id
  `);
  pgm.sql('ALTER TABLE trading_partners.customer FORCE ROW LEVEL SECURITY');
  pgm.dropTable({ schema: 'trading_partners', name: 'route_stop' });
};
