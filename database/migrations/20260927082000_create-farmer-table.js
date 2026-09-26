/* eslint-disable camelcase */

// Domain Model, Trading Partners tier: who the wholesaler buys from — the
// structural mirror of customer. bank_details is stored encrypted
// (pgcrypto pgp_sym_encrypt/pgp_sym_decrypt, key from
// FIELD_ENCRYPTION_KEY) rather than as plain jsonb — payout details are
// financial PII (Constitution V.4). Encryption/decryption happens in
// FarmersRepository, parameterized, never by interpolating the key into
// SQL text.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'trading_partners', name: 'farmer' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      name: { type: 'text', notNull: true },
      contact: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
      bank_details_encrypted: { type: 'bytea' }, // nullable — may be added after onboarding
      reliability_rating: { type: 'numeric(3,2)' }, // nullable, 0.00-5.00
      status: { type: 'text', notNull: true, default: 'active' }, // active | archived
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

  pgm.addConstraint('farmer', 'farmer_reliability_rating_range', {
    check: 'reliability_rating IS NULL OR (reliability_rating >= 0 AND reliability_rating <= 5)',
    schema: 'trading_partners',
  });
  pgm.addConstraint('farmer', 'farmer_status_valid', {
    check: "status IN ('active', 'archived')",
    schema: 'trading_partners',
  });

  pgm.createIndex({ schema: 'trading_partners', name: 'farmer' }, ['tenant_id', 'name']);
  pgm.sql('ALTER TABLE trading_partners.farmer ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE trading_partners.farmer FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY farmer_tenant_isolation ON trading_partners.farmer
      USING (tenant_id = current_tenant_id())
  `);
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'trading_partners', name: 'farmer' });
};
