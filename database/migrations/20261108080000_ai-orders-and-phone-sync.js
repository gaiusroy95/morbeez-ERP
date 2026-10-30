/* eslint-disable camelcase */

// Owner app redesign, Phase 8 — AI and sync screens (docs/redesign/owner-app-redesign-plan.md).
//
// 1. A seventh kind of AI suggestion, "order" (requirements Part 14, AI Order
//    Intelligence; Part 23, AI Order Calling): a customer who orders on this
//    weekday hasn't yet — their usual order, for the owner to place — and an
//    order far from what the customer usually takes, to confirm. Decided, like
//    credit terms, by whoever holds ai:decide:customers (the owner).
// 2. identity.device_sync: what each driver's phone last said about its
//    offline queue — waiting, stuck and why — so the owner sees a phone that
//    hasn't sent the day's work (the client's Offline Sync screen). One row
//    per login and phone, replaced on every report.

exports.shorthands = undefined;

const TYPES = ['pricing', 'procurement', 'logistics_route', 'logistics_load', 'customer_terms', 'exception'];
const list = (types) => types.map((x) => `'${x}'`).join(', ');

function recommendationTypes(pgm, types) {
  pgm.sql('ALTER TABLE ai.recommendation DROP CONSTRAINT recommendation_valid');
  pgm.sql(`ALTER TABLE ai.recommendation ADD CONSTRAINT recommendation_valid CHECK (
    type IN (${list(types)}) AND confidence IN ('solid', 'rough_guide', 'early_estimate')
    AND jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) >= 1 AND expires_at > created_at)`);
  pgm.sql('ALTER TABLE ai.ai_settings DROP CONSTRAINT ai_settings_valid');
  pgm.sql(`ALTER TABLE ai.ai_settings ADD CONSTRAINT ai_settings_valid CHECK (
    target_margin_pct BETWEEN 0 AND 200 AND max_price_move_pct BETWEEN 1 AND 100 AND min_customer_margin_pct BETWEEN -100 AND 100
    AND cost_of_capital_pct BETWEEN 0 AND 60 AND default_cost_per_km > 0 AND disabled_types <@ ARRAY[${list(types)}]::text[])`);
}

exports.up = (pgm) => {
  recommendationTypes(pgm, [...TYPES, 'order']);
  pgm.sql(`UPDATE identity.permission SET description = 'Act on or dismiss customer suggestions: credit terms and orders' WHERE code = 'ai:decide:customers'`);

  pgm.createTable({ schema: 'identity', name: 'device_sync' }, {
    tenant_id: { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' },
    user_id: { type: 'uuid', notNull: true, primaryKey: true, references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' },
    // The phone's own id (the one its sign-in and PIN are bound to).
    device_id: { type: 'text', notNull: true, primaryKey: true },
    platform: { type: 'text', notNull: true },
    app_version: { type: 'text', notNull: true },
    // Actions and photos recorded on the phone the server hasn't had yet; of them, those it refused.
    pending_operations: { type: 'integer', notNull: true },
    failed_operations: { type: 'integer', notNull: true },
    pending_photos: { type: 'integer', notNull: true },
    failed_photos: { type: 'integer', notNull: true },
    oldest_pending_at: { type: 'timestamptz' },
    // What was refused, in the server's words: [{"type", "error", "at"}], at most 20.
    failures: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    // success | partial: how the phone's last pass went, and when.
    last_result: { type: 'text', notNull: true },
    synced_at: { type: 'timestamptz', notNull: true },
    reported_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint({ schema: 'identity', name: 'device_sync' }, 'device_sync_valid', {
    check: `platform IN ('android', 'ios', 'web') AND last_result IN ('success', 'partial')
            AND pending_operations >= 0 AND failed_operations BETWEEN 0 AND pending_operations
            AND pending_photos >= 0 AND failed_photos BETWEEN 0 AND pending_photos
            AND jsonb_typeof(failures) = 'array' AND jsonb_array_length(failures) <= 20
            AND length(device_id) BETWEEN 1 AND 100 AND length(app_version) BETWEEN 1 AND 40`,
  });
  pgm.createIndex({ schema: 'identity', name: 'device_sync' }, ['tenant_id', 'reported_at']);
  pgm.sql('ALTER TABLE identity.device_sync ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE identity.device_sync FORCE ROW LEVEL SECURITY');
  pgm.sql('CREATE POLICY device_sync_tenant_isolation ON identity.device_sync USING (tenant_id = current_tenant_id())');
  pgm.sql('GRANT SELECT, INSERT, UPDATE ON identity.device_sync TO morbeez_app');
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'identity', name: 'device_sync' });
  pgm.sql(`UPDATE identity.permission SET description = 'Act on or dismiss customer-terms suggestions' WHERE code = 'ai:decide:customers'`);
  pgm.sql(`DELETE FROM ai.recommendation_decision WHERE recommendation_id IN (SELECT id FROM ai.recommendation WHERE type = 'order')`);
  pgm.sql(`DELETE FROM ai.recommendation WHERE type = 'order'`);
  pgm.sql(`UPDATE ai.ai_settings SET disabled_types = array_remove(disabled_types, 'order')`);
  recommendationTypes(pgm, TYPES);
};
