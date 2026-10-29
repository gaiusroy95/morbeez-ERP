/* eslint-disable camelcase */

// Owner app redesign, Phase 2 — Procurement (docs/redesign): what the
// client's "Procurement" list and "Create Procurement" form show.
//
// 1. commerce.document_counter: per-business running numbers for
//    documents the owner reads out (P-00123 purchase orders now; delivery
//    orders and trips in later phases). Never reused.
// 2. purchase_order: its number, the pickup plan (date, time, driver, vehicle —
//    turned into a pickup once the order is confirmed), an agent with a
//    commission per kg, and notes.
// 3. purchase_order_line: bought by the bag as well as by the kilo — the
//    line keeps its quantity in the product's unit (kg) and remembers the
//    bags and kg per bag it was entered as.
// 4. trading_partners.agent: middlemen who bring produce for a commission.
// 5. farmer.place: the village or town shown under the farmer's name.

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };

function isolate(pgm, schema, table) {
  pgm.sql(`ALTER TABLE ${schema}.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE ${schema}.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON ${schema}.${table} USING (tenant_id = current_tenant_id())`);
}

exports.up = (pgm) => {
  pgm.createTable({ schema: 'commerce', name: 'document_counter' }, {
    tenant_id: { ...tenantColumn, primaryKey: true },
    kind: { type: 'text', primaryKey: true },
    last_number: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addConstraint({ schema: 'commerce', name: 'document_counter' }, 'document_counter_kind_valid', {
    check: "kind IN ('purchase_order', 'customer_order', 'trip')",
  });
  isolate(pgm, 'commerce', 'document_counter');

  pgm.createTable({ schema: 'trading_partners', name: 'agent' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    name: { type: 'text', notNull: true },
    phone: { type: 'text' },
    default_commission_per_kg: { type: 'numeric(10,2)', notNull: true, default: 0 },
    status: { type: 'text', notNull: true, default: 'active' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint({ schema: 'trading_partners', name: 'agent' }, 'agent_valid', {
    check: "status IN ('active', 'archived') AND default_commission_per_kg >= 0 AND length(trim(name)) >= 2",
  });
  isolate(pgm, 'trading_partners', 'agent');

  pgm.addColumns({ schema: 'commerce', name: 'purchase_order' }, {
    number: { type: 'integer' },
    pickup_date: { type: 'date' },
    pickup_time: { type: 'time' },
    planned_driver_id: { type: 'uuid', references: { schema: 'trading_partners', name: 'employee' }, onDelete: 'RESTRICT' },
    planned_vehicle_id: { type: 'uuid', references: { schema: 'trading_partners', name: 'vehicle' }, onDelete: 'RESTRICT' },
    agent_id: { type: 'uuid', references: { schema: 'trading_partners', name: 'agent' }, onDelete: 'RESTRICT' },
    commission_per_kg: { type: 'numeric(10,2)' },
    notes: { type: 'text' },
  });
  pgm.addConstraint({ schema: 'commerce', name: 'purchase_order' }, 'purchase_order_commission_valid', {
    check: 'commission_per_kg IS NULL OR (commission_per_kg >= 0 AND agent_id IS NOT NULL)',
  });

  pgm.addColumns({ schema: 'commerce', name: 'purchase_order_line' }, {
    bags: { type: 'numeric(12,3)' },
    kg_per_bag: { type: 'numeric(10,3)' },
  });
  pgm.addConstraint({ schema: 'commerce', name: 'purchase_order_line' }, 'purchase_order_line_bags_valid', {
    check: '(bags IS NULL) = (kg_per_bag IS NULL) AND (bags IS NULL OR (bags > 0 AND kg_per_bag > 0))',
  });

  pgm.addColumns({ schema: 'trading_partners', name: 'farmer' }, { place: { type: 'text' } });

  // Number the purchase orders that already exist, oldest first, per
  // business. FORCE ROW LEVEL SECURITY would hide every row from a
  // non-superuser owner (RDS, Neon), so it's lifted around the backfill.
  pgm.sql('ALTER TABLE commerce.purchase_order NO FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE commerce.document_counter NO FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    UPDATE commerce.purchase_order po SET number = n.rn, pickup_date = po.expected_delivery_date
    FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn FROM commerce.purchase_order) n
    WHERE n.id = po.id
  `);
  pgm.sql(`
    INSERT INTO commerce.document_counter (tenant_id, kind, last_number)
    SELECT tenant_id, 'purchase_order', max(number) FROM commerce.purchase_order GROUP BY tenant_id
  `);
  pgm.sql('ALTER TABLE commerce.document_counter FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE commerce.purchase_order FORCE ROW LEVEL SECURITY');
  pgm.alterColumn({ schema: 'commerce', name: 'purchase_order' }, 'number', { notNull: true });
  pgm.addConstraint({ schema: 'commerce', name: 'purchase_order' }, 'purchase_order_number_unique', { unique: ['tenant_id', 'number'] });
  pgm.createIndex({ schema: 'commerce', name: 'purchase_order' }, ['tenant_id', 'pickup_date']);
};

exports.down = (pgm) => {
  pgm.dropIndex({ schema: 'commerce', name: 'purchase_order' }, ['tenant_id', 'pickup_date']);
  pgm.dropConstraint({ schema: 'commerce', name: 'purchase_order' }, 'purchase_order_number_unique');
  pgm.dropColumns({ schema: 'trading_partners', name: 'farmer' }, ['place']);
  pgm.dropConstraint({ schema: 'commerce', name: 'purchase_order_line' }, 'purchase_order_line_bags_valid');
  pgm.dropColumns({ schema: 'commerce', name: 'purchase_order_line' }, ['bags', 'kg_per_bag']);
  pgm.dropConstraint({ schema: 'commerce', name: 'purchase_order' }, 'purchase_order_commission_valid');
  pgm.dropColumns({ schema: 'commerce', name: 'purchase_order' }, [
    'number',
    'pickup_date',
    'pickup_time',
    'planned_driver_id',
    'planned_vehicle_id',
    'agent_id',
    'commission_per_kg',
    'notes',
  ]);
  pgm.dropTable({ schema: 'trading_partners', name: 'agent' });
  pgm.dropTable({ schema: 'commerce', name: 'document_counter' });
};
