/* eslint-disable camelcase */

// The AI System (Morbeez AI System design, DR/PIPE/REC/EVAL/AISEC;
// Constitution Article VIII): recommendations the owner decides on.
//
//   morbeez_ai            — a role with SELECT only, which the AI's
//                           computations SET ROLE to, in a READ ONLY
//                           transaction (DR.1, VIII.1): the database itself
//                           refuses any write they attempt. RLS still
//                           applies (policies are for every role).
//   ai.ai_settings        — the tenant's knobs: target margin, how far a price
//                           may move in one step, cost of capital, a default
//                           cost per km, which types are switched off (DR.6).
//   ai.run                — each computation: when, what it produced, what it
//                           suppressed and why (PIPE.6).
//   ai.recommendation     — one suggestion: its proposal, evidence, confidence,
//                           expiry, producer. Insert-only (REC.4).
//   ai.recommendation_decision — accepted, modified, dismissed or expired;
//                           one per recommendation, never changed (DR.4).
//   fulfilment.place_pin  — map pins for customers, farmers and the depot, for
//                           route planning. Owned by Logistics, set by people.

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const userColumn = { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };
const t = (name) => ({ schema: 'ai', name });
const READ_SCHEMAS = ['tenant', 'trading_partners', 'commerce', 'stock', 'fulfilment', 'money', 'tax', 'workforce', 'fleet', 'crates', 'spot'];
const TYPES = "('pricing', 'procurement', 'logistics_route', 'logistics_load', 'customer_terms', 'exception')";

function isolate(pgm, table, updatable) {
  pgm.sql(`ALTER TABLE ai.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE ai.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON ai.${table} USING (tenant_id = current_tenant_id())`);
  pgm.sql(`GRANT SELECT, INSERT ON ai.${table} TO morbeez_app`);
  if (updatable === '*') pgm.sql(`GRANT UPDATE ON ai.${table} TO morbeez_app`);
}

exports.up = (pgm) => {
  // ---- The read-only role the AI computes as ----
  pgm.sql(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'morbeez_ai') THEN
      CREATE ROLE morbeez_ai NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$`);
  pgm.sql('GRANT morbeez_ai TO morbeez_app');
  for (const schema of READ_SCHEMAS) {
    pgm.sql(`GRANT USAGE ON SCHEMA ${schema} TO morbeez_ai`);
    pgm.sql(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO morbeez_ai`);
    pgm.sql(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT ON TABLES TO morbeez_ai`);
  }

  pgm.createSchema('ai', { ifNotExists: true });
  pgm.sql('GRANT USAGE ON SCHEMA ai TO morbeez_app, morbeez_ai');

  pgm.createTable(t('ai_settings'), {
    tenant_id: { ...tenantColumn, primaryKey: true },
    target_margin_pct: { type: 'numeric(5,2)', notNull: true, default: 20 },
    max_price_move_pct: { type: 'numeric(5,2)', notNull: true, default: 15 },
    min_customer_margin_pct: { type: 'numeric(5,2)', notNull: true, default: 5 },
    cost_of_capital_pct: { type: 'numeric(5,2)', notNull: true, default: 12 },
    default_cost_per_km: { type: 'numeric(8,2)', notNull: true, default: 18 },
    disabled_types: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
    version: { type: 'integer', notNull: true, default: 1 },
    updated_by: userColumn,
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('ai_settings'), 'ai_settings_valid', {
    check: `target_margin_pct BETWEEN 0 AND 200 AND max_price_move_pct BETWEEN 1 AND 100 AND min_customer_margin_pct BETWEEN -100 AND 100
            AND cost_of_capital_pct BETWEEN 0 AND 60 AND default_cost_per_km > 0 AND disabled_types <@ ARRAY${TYPES.replace('(', '[').replace(')', ']')}::text[]`,
  });
  isolate(pgm, 'ai_settings', '*');

  pgm.createTable(t('run'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    started_at: { type: 'timestamptz', notNull: true },
    finished_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    produced: { type: 'jsonb', notNull: true }, // {"pricing": 3, ...}
    suppressed: { type: 'jsonb', notNull: true }, // {"procurement": "Not enough sales history"}
    created_by: { ...userColumn, notNull: true },
  });
  pgm.createIndex(t('run'), ['tenant_id', 'started_at']);
  isolate(pgm, 'run', []);

  pgm.createTable(t('recommendation'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    run_id: { type: 'uuid', notNull: true, references: t('run'), onDelete: 'RESTRICT' },
    type: { type: 'text', notNull: true },
    subject_kind: { type: 'text', notNull: true },
    subject_id: { type: 'uuid' },
    target_date: { type: 'date' },
    title: { type: 'text', notNull: true },
    proposal: { type: 'jsonb', notNull: true },
    evidence: { type: 'jsonb', notNull: true },
    explanation: { type: 'text', notNull: true },
    expected_impact: { type: 'numeric(14,2)' },
    confidence: { type: 'text', notNull: true },
    sensitive: { type: 'boolean', notNull: true, default: false },
    producer: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('recommendation'), 'recommendation_valid', {
    check: `type IN ${TYPES} AND confidence IN ('solid', 'rough_guide', 'early_estimate')
            AND jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) >= 1 AND expires_at > created_at`,
  });
  pgm.createIndex(t('recommendation'), ['tenant_id', 'type', 'created_at']);
  pgm.createIndex(t('recommendation'), ['subject_kind', 'subject_id']);
  isolate(pgm, 'recommendation', []);

  pgm.createTable(t('recommendation_decision'), {
    recommendation_id: { type: 'uuid', primaryKey: true, references: t('recommendation'), onDelete: 'RESTRICT' },
    tenant_id: tenantColumn,
    decision: { type: 'text', notNull: true },
    decided_by: userColumn,
    decided_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    submitted: { type: 'jsonb' },
    reason: { type: 'text' },
    result_ref: { type: 'jsonb' },
  });
  pgm.addConstraint(t('recommendation_decision'), 'recommendation_decision_valid', {
    check: `decision IN ('accepted', 'modified', 'dismissed', 'expired')
            AND (decision = 'expired') = (decided_by IS NULL)
            AND (decision <> 'dismissed' OR reason IS NOT NULL)`,
  });
  isolate(pgm, 'recommendation_decision', []);
  pgm.sql('GRANT SELECT ON ALL TABLES IN SCHEMA ai TO morbeez_ai');

  // ---- Map pins, for route planning (Logistics) ----
  pgm.createTable({ schema: 'fulfilment', name: 'place_pin' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    kind: { type: 'text', notNull: true },
    ref_id: { type: 'uuid' },
    latitude: { type: 'numeric(9,6)', notNull: true },
    longitude: { type: 'numeric(9,6)', notNull: true },
    updated_by: { ...userColumn, notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint({ schema: 'fulfilment', name: 'place_pin' }, 'place_pin_valid', {
    check: `kind IN ('customer', 'farmer', 'depot') AND (kind = 'depot') = (ref_id IS NULL)
            AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180`,
  });
  pgm.sql(`CREATE UNIQUE INDEX place_pin_one_per_place ON fulfilment.place_pin
             (tenant_id, kind, COALESCE(ref_id, '00000000-0000-0000-0000-000000000000'::uuid))`);
  pgm.sql('ALTER TABLE fulfilment.place_pin ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE fulfilment.place_pin FORCE ROW LEVEL SECURITY');
  pgm.sql('CREATE POLICY place_pin_tenant_isolation ON fulfilment.place_pin USING (tenant_id = current_tenant_id())');
  pgm.sql('GRANT SELECT, INSERT, UPDATE, DELETE ON fulfilment.place_pin TO morbeez_app');
  pgm.sql('GRANT SELECT ON fulfilment.place_pin TO morbeez_ai');

  pgm.sql(`
    INSERT INTO identity.permission (code, description) VALUES
      ('ai:read', 'See AI suggestions, their evidence and track record, and ask for fresh ones'),
      ('ai:configure', 'Set how the AI suggests: target margin, price step, cost of capital, switched-off types'),
      ('ai:decide:pricing', 'Act on or dismiss price suggestions'),
      ('ai:decide:procurement', 'Act on or dismiss buying suggestions'),
      ('ai:decide:logistics', 'Act on or dismiss route and load suggestions'),
      ('ai:decide:customers', 'Act on or dismiss customer-terms suggestions'),
      ('ai:decide:exceptions', 'See and close exception flags, including those about people')
    ON CONFLICT (code) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql("DELETE FROM identity.role_permission WHERE permission_id IN (SELECT id FROM identity.permission WHERE code LIKE 'ai:%')");
  pgm.sql("DELETE FROM identity.permission WHERE code LIKE 'ai:%'");
  pgm.dropTable({ schema: 'fulfilment', name: 'place_pin' });
  pgm.dropSchema('ai', { cascade: true });
  for (const schema of READ_SCHEMAS) {
    pgm.sql(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} REVOKE SELECT ON TABLES FROM morbeez_ai`);
    pgm.sql(`REVOKE SELECT ON ALL TABLES IN SCHEMA ${schema} FROM morbeez_ai`);
    pgm.sql(`REVOKE USAGE ON SCHEMA ${schema} FROM morbeez_ai`);
  }
  pgm.sql('REVOKE morbeez_ai FROM morbeez_app');
  pgm.sql('DROP ROLE IF EXISTS morbeez_ai');
};
