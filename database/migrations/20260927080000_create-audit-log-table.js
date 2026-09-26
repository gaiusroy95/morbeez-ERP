/* eslint-disable camelcase */

// Constitution V.5 — every sensitive action writes an immutable audit
// entry. Insert-only: morbeez_app's default grant from
// create-app-runtime-role includes UPDATE/DELETE (it's a blanket DML
// grant meant for ordinary mutable tables), so this migration explicitly
// revokes both for this one table right after creating it — an audit log
// that the application itself could edit isn't one.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'infra', name: 'audit_log' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      actor_user_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
      action: { type: 'text', notNull: true }, // create | update | archive | restore
      entity_type: { type: 'text', notNull: true },
      entity_id: { type: 'uuid', notNull: true },
      before_state: { type: 'jsonb' },
      after_state: { type: 'jsonb' },
      occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );

  pgm.createIndex(
    { schema: 'infra', name: 'audit_log' },
    ['tenant_id', 'entity_type', 'entity_id'],
  );
  pgm.createIndex({ schema: 'infra', name: 'audit_log' }, ['tenant_id', 'occurred_at']);

  pgm.sql('ALTER TABLE infra.audit_log ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE infra.audit_log FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY audit_log_tenant_isolation ON infra.audit_log
      USING (tenant_id = current_tenant_id())
  `);

  // Narrower than the schema-wide default (create-app-runtime-role) —
  // insert and read only.
  pgm.sql('REVOKE UPDATE, DELETE ON infra.audit_log FROM morbeez_app');
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'infra', name: 'audit_log' });
};
