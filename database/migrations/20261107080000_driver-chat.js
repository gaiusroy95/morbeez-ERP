/* eslint-disable camelcase */

// Driver app V1, Phase D9 — driver–owner chat (docs/redesign/driver-app-v1-plan.md;
// the client's answer 9: chat is part of V1). One conversation per driver
// with the business — any message may be about a trip — with photos; who
// has read up to where, so both apps show what's unread. Messages come from
// the phone with their own id (sent again when back online, they're one).
//
// 1. chat.message: insert-only but for its photo, attached once after it.
// 2. chat.read_marker: how far each person has read each driver's conversation.

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const t = (name) => ({ schema: 'chat', name });

function isolate(pgm, table, updatable) {
  pgm.sql(`ALTER TABLE chat.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE chat.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON chat.${table} USING (tenant_id = current_tenant_id())`);
  pgm.sql(`GRANT SELECT, INSERT ON chat.${table} TO morbeez_app`);
  if (updatable === '*') pgm.sql(`GRANT UPDATE ON chat.${table} TO morbeez_app`);
  else if (updatable.length) pgm.sql(`GRANT UPDATE (${updatable.join(', ')}) ON chat.${table} TO morbeez_app`);
}

exports.up = (pgm) => {
  pgm.createSchema('chat', { ifNotExists: true });
  pgm.sql('GRANT USAGE ON SCHEMA chat TO morbeez_app');

  pgm.createTable(t('message'), {
    id: { type: 'uuid', primaryKey: true },
    tenant_id: tenantColumn,
    // The conversation: the driver's, with the business.
    driver_employee_id: { type: 'uuid', notNull: true, references: { schema: 'trading_partners', name: 'employee' }, onDelete: 'RESTRICT' },
    sender_user_id: { type: 'uuid', notNull: true, references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' },
    // driver | office: which side of the conversation wrote it.
    side: { type: 'text', notNull: true },
    body: { type: 'text' },
    trip_id: { type: 'uuid', references: { schema: 'fulfilment', name: 'trip' }, onDelete: 'RESTRICT' },
    // A photo message: the photo follows the message, once.
    photo_expected: { type: 'boolean', notNull: true, default: false },
    photo_key: { type: 'text' },
    photo_content_type: { type: 'text' },
    // When the phone wrote it (offline, it reaches the server later).
    written_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('message'), 'message_valid', {
    check: `side IN ('driver', 'office')
            AND (body IS NULL OR length(btrim(body)) BETWEEN 1 AND 2000)
            AND (body IS NOT NULL OR photo_expected)
            AND (photo_key IS NULL) = (photo_content_type IS NULL)
            AND (photo_key IS NULL OR photo_expected)`,
  });
  pgm.createIndex(t('message'), ['tenant_id', 'driver_employee_id', 'created_at']);
  pgm.createIndex(t('message'), 'trip_id', { where: 'trip_id IS NOT NULL' });
  isolate(pgm, 'message', ['photo_key', 'photo_content_type']);

  pgm.createTable(t('read_marker'), {
    tenant_id: tenantColumn,
    user_id: { type: 'uuid', notNull: true, primaryKey: true, references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' },
    driver_employee_id: { type: 'uuid', notNull: true, primaryKey: true, references: { schema: 'trading_partners', name: 'employee' }, onDelete: 'RESTRICT' },
    read_at: { type: 'timestamptz', notNull: true },
  });
  isolate(pgm, 'read_marker', ['read_at']);
};

exports.down = (pgm) => {
  pgm.dropTable(t('read_marker'));
  pgm.dropTable(t('message'));
  pgm.dropSchema('chat');
};
