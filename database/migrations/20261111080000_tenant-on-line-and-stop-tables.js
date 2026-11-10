/* eslint-disable camelcase */

// Row-level security on the last seven tables of one business's data that
// went without it (Master Spec v3 P0, found by database/scripts/schema-report.js):
// order lines, purchase-order lines, trip stops, their photos and proofs of
// delivery, trip expenses and trip reconciliations. They had no tenant_id and
// were reached only through their tenant-scoped parent; a query that skipped
// the parent could read another business's rows.
//
// Each gets tenant_id, filled from its parent (FORCE lifted on the parents
// around the backfill — a non-superuser owner sees nothing through it), and
// kept true by a trigger: on insert it takes the parent's tenant, and refuses
// a parent the session can't see or a tenant_id that isn't the parent's. So
// no INSERT anywhere needs changing, and a row can never be attached across
// businesses (a foreign key check ignores RLS; the trigger doesn't). Then
// RLS on, forced, the standard tenant-isolation policy, and an index for it.

exports.shorthands = undefined;

const CHILDREN = [
  // In this order: trip_stop has its tenant before its photos and PODs read it.
  { schema: 'commerce', name: 'customer_order_line', parentCol: 'order_id', parent: 'commerce.customer_order' },
  { schema: 'commerce', name: 'purchase_order_line', parentCol: 'purchase_order_id', parent: 'commerce.purchase_order' },
  { schema: 'fulfilment', name: 'trip_stop', parentCol: 'trip_id', parent: 'fulfilment.trip' },
  { schema: 'fulfilment', name: 'trip_expense', parentCol: 'trip_id', parent: 'fulfilment.trip' },
  { schema: 'fulfilment', name: 'trip_reconciliation', parentCol: 'trip_id', parent: 'fulfilment.trip' },
  { schema: 'fulfilment', name: 'trip_stop_photo', parentCol: 'trip_stop_id', parent: 'fulfilment.trip_stop' },
  { schema: 'fulfilment', name: 'trip_stop_pod', parentCol: 'trip_stop_id', parent: 'fulfilment.trip_stop' },
];
const FORCED_PARENTS = ['commerce.customer_order', 'commerce.purchase_order', 'fulfilment.trip'];

exports.up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION tenant.inherit_tenant_id() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      parent_tenant uuid;
    BEGIN
      -- TG_ARGV: the parent table, and this row's column that points at it.
      EXECUTE format('SELECT tenant_id FROM %s WHERE id = $1', TG_ARGV[0])
        INTO parent_tenant USING (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
      IF parent_tenant IS NULL THEN
        RAISE EXCEPTION '%.%: its % is not a row this business can see', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_ARGV[1]
          USING ERRCODE = 'foreign_key_violation';
      END IF;
      IF NEW.tenant_id IS NULL THEN
        NEW.tenant_id := parent_tenant;
      ELSIF NEW.tenant_id <> parent_tenant THEN
        RAISE EXCEPTION '%.%: tenant_id is not its parent''s', TG_TABLE_SCHEMA, TG_TABLE_NAME
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END
    $$
  `);

  for (const p of FORCED_PARENTS) pgm.sql(`ALTER TABLE ${p} NO FORCE ROW LEVEL SECURITY`);
  for (const c of CHILDREN) {
    const table = `${c.schema}.${c.name}`;
    pgm.addColumns({ schema: c.schema, name: c.name }, {
      tenant_id: { type: 'uuid', references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' },
    });
    pgm.sql(`UPDATE ${table} c SET tenant_id = p.tenant_id FROM ${c.parent} p WHERE p.id = c.${c.parentCol}`);
    pgm.alterColumn({ schema: c.schema, name: c.name }, 'tenant_id', { notNull: true });
    pgm.sql(`
      CREATE TRIGGER ${c.name}_tenant BEFORE INSERT OR UPDATE OF tenant_id, ${c.parentCol} ON ${table}
        FOR EACH ROW EXECUTE FUNCTION tenant.inherit_tenant_id('${c.parent}', '${c.parentCol}')
    `);
    pgm.createIndex({ schema: c.schema, name: c.name }, ['tenant_id', c.parentCol]);
  }
  for (const p of FORCED_PARENTS) pgm.sql(`ALTER TABLE ${p} FORCE ROW LEVEL SECURITY`);

  for (const c of CHILDREN) {
    const table = `${c.schema}.${c.name}`;
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    pgm.sql(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    pgm.sql(`CREATE POLICY ${c.name}_tenant_isolation ON ${table} USING (tenant_id = current_tenant_id())`);
  }
};

exports.down = (pgm) => {
  for (const c of [...CHILDREN].reverse()) {
    const table = `${c.schema}.${c.name}`;
    pgm.sql(`DROP POLICY ${c.name}_tenant_isolation ON ${table}`);
    pgm.sql(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`);
    pgm.sql(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    pgm.sql(`DROP TRIGGER ${c.name}_tenant ON ${table}`);
    pgm.dropIndex({ schema: c.schema, name: c.name }, ['tenant_id', c.parentCol]);
    pgm.dropColumns({ schema: c.schema, name: c.name }, ['tenant_id']);
  }
  pgm.sql('DROP FUNCTION tenant.inherit_tenant_id()');
};
