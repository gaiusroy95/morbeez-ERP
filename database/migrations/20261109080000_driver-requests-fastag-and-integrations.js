/* eslint-disable camelcase */

// What was left after driver app D8 and owner Phase 8 (docs/redesign):
//
// 1. fulfilment.driver_request: what a driver asks the office for from the
//    road — a cash advance, a new customer met on the route, a higher credit
//    limit for a customer — decided in the owner's Approvals inbox. Approving
//    one does it in the same transaction: the advance paid, the customer
//    created (with its map pin), the limit set. Its id may come from the
//    phone, so a request made offline is the same request however often it's
//    sent.
// 2. FASTag: a vehicle's tag and the balance below which the owner is told
//    (fleet.fastag); fleet.fastag_entry, every recharge and everything taken
//    off the tag. A trip's toll or parking may be paid by FASTag instead of
//    the driver's cash (trip_expense.paid_by): it comes off the tag's
//    balance, never the driver's float. The balance is an asset,
//    'fastag_balance'.
// 3. Integrations: tenant.integration_setting — which WhatsApp number is this
//    business's, whether the customer gets a reply, whether the owner may
//    have customers called automatically; ai.inbound_message, every WhatsApp
//    message received and what came of it; ai.voice_call, every automated
//    call and what the customer pressed. The providers' webhooks carry no
//    tenant: SECURITY DEFINER lookups find it, as for sign-in.
// 4. An AI run may come from a WhatsApp message rather than the owner
//    (ai.run.source; created_by only for the owner's runs).
// 5. Alert kinds: driver_request, fastag_low.

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const userColumn = { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };
const vehicleColumn = { type: 'uuid', notNull: true, references: { schema: 'trading_partners', name: 'vehicle' }, onDelete: 'RESTRICT' };
const customerColumn = { type: 'uuid', references: { schema: 'trading_partners', name: 'customer' }, onDelete: 'RESTRICT' };

const REQUEST = { schema: 'fulfilment', name: 'driver_request' };
const EXPENSE = { schema: 'fulfilment', name: 'trip_expense' };
const FASTAG = { schema: 'fleet', name: 'fastag' };
const FASTAG_ENTRY = { schema: 'fleet', name: 'fastag_entry' };
const INTEGRATION = { schema: 'tenant', name: 'integration_setting' };
const INBOUND = { schema: 'ai', name: 'inbound_message' };
const CALL = { schema: 'ai', name: 'voice_call' };
const RUN = { schema: 'ai', name: 'run' };
const ALERT = { schema: 'tenant', name: 'owner_alert' };

const OLD_ALERT_KINDS = [
  'cash_mismatch', 'collection_discrepancy', 'inventory_mismatch', 'customer_rejection', 'procurement_issue',
  'driver_unable_to_continue', 'trip_blocked', 'operational_problem', 'security', 'shrinkage', 'breakage', 'dispute_stale',
];
const ALERT_KINDS = [...OLD_ALERT_KINDS, 'driver_request', 'fastag_low'];
const REQUEST_KINDS = ['advance', 'new_customer', 'credit_limit'];
const MESSAGE_STATUSES = ['received', 'suggested', 'no_customer', 'no_order', 'not_text', 'failed'];
const CALL_PURPOSES = ['payment_reminder', 'order_reminder', 'order_confirm'];
const CALL_STATUSES = ['queued', 'ringing', 'in_progress', 'completed', 'busy', 'no_answer', 'failed', 'canceled'];
const list = (xs) => xs.map((x) => `'${x}'`).join(', ');

function isolate(pgm, schema, table, grants) {
  pgm.sql(`ALTER TABLE ${schema}.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE ${schema}.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON ${schema}.${table} USING (tenant_id = current_tenant_id())`);
  pgm.sql(`GRANT ${grants} ON ${schema}.${table} TO morbeez_app`);
}

exports.up = (pgm) => {
  // ---- 1. Driver requests ----
  pgm.createTable(REQUEST, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    driver_employee_id: { type: 'uuid', notNull: true, references: { schema: 'trading_partners', name: 'employee' }, onDelete: 'RESTRICT' },
    // The trip the driver was on when they asked, if any.
    trip_id: { type: 'uuid', references: { schema: 'fulfilment', name: 'trip' }, onDelete: 'RESTRICT' },
    kind: { type: 'text', notNull: true },
    // An advance: how much. A credit limit: the limit asked for.
    amount: { type: 'numeric(12,2)' },
    // A credit limit: whose.
    customer_id: customerColumn,
    // A new customer: {"name", "phone", "place", "address", "latitude", "longitude", "language"}.
    details: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    reason: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'pending' },
    requested_by: { ...userColumn, notNull: true },
    requested_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    decided_by: userColumn,
    decided_at: { type: 'timestamptz' },
    decision_note: { type: 'text' },
    // What approving it made: the advance, or the new customer.
    result_ref: { type: 'uuid' },
  });
  pgm.addConstraint(REQUEST, 'driver_request_valid', {
    check: `kind IN (${list(REQUEST_KINDS)}) AND status IN ('pending', 'approved', 'rejected')
            AND length(btrim(reason)) BETWEEN 1 AND 500 AND jsonb_typeof(details) = 'object'
            AND (kind <> 'advance' OR (amount > 0 AND customer_id IS NULL))
            AND (kind <> 'credit_limit' OR (amount >= 0 AND customer_id IS NOT NULL))
            AND (kind <> 'new_customer' OR (amount IS NULL AND customer_id IS NULL AND length(btrim(details->>'name')) >= 2))`,
  });
  pgm.addConstraint(REQUEST, 'driver_request_decision_valid', {
    check: `(status = 'pending') = (decided_at IS NULL) AND (status = 'pending') = (decided_by IS NULL)
            AND (status <> 'rejected' OR length(btrim(decision_note)) > 0)
            AND (status = 'approved') = (result_ref IS NOT NULL)`,
  });
  pgm.createIndex(REQUEST, ['tenant_id', 'status', 'requested_at']);
  pgm.createIndex(REQUEST, ['driver_employee_id', 'requested_at']);
  isolate(pgm, 'fulfilment', 'driver_request', 'SELECT, INSERT, UPDATE');
  pgm.sql('REVOKE DELETE ON fulfilment.driver_request FROM morbeez_app');

  // ---- 2. FASTag ----
  pgm.createTable(FASTAG, {
    vehicle_id: { ...vehicleColumn, primaryKey: true },
    tenant_id: tenantColumn,
    // The tag's number, or the issuing bank's id for it — as on the statement.
    tag_id: { type: 'text', notNull: true },
    issuer: { type: 'text' },
    // Below this the owner is told to recharge.
    low_balance: { type: 'numeric(12,2)', notNull: true, default: 500 },
    updated_by: { ...userColumn, notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(FASTAG, 'fastag_valid', { check: 'length(btrim(tag_id)) BETWEEN 1 AND 40 AND low_balance >= 0' });
  isolate(pgm, 'fleet', 'fastag', 'SELECT, INSERT, UPDATE');

  pgm.createTable(FASTAG_ENTRY, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    vehicle_id: vehicleColumn,
    // recharge: money put on the tag. toll: a trip's toll or parking the
    // driver paid by tag. charge: something on the tag's statement no trip
    // recorded (a toll the driver didn't note, the bank's fee).
    kind: { type: 'text', notNull: true },
    // Signed: what it did to the balance.
    amount: { type: 'numeric(12,2)', notNull: true },
    occurred_on: { type: 'date', notNull: true },
    paid_from: { type: 'text' },
    trip_expense_id: { type: 'uuid', references: EXPENSE, onDelete: 'RESTRICT', unique: true },
    reference: { type: 'text' },
    notes: { type: 'text' },
    ledger_entry_id: { type: 'uuid', notNull: true, references: { schema: 'money', name: 'ledger_entry' }, onDelete: 'RESTRICT' },
    created_by: { ...userColumn, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(FASTAG_ENTRY, 'fastag_entry_valid', {
    check: `kind IN ('recharge', 'toll', 'charge') AND amount <> 0
            AND (kind = 'recharge') = (amount > 0)
            AND (kind = 'recharge') = (paid_from IS NOT NULL) AND (paid_from IS NULL OR paid_from IN ('bank', 'cash_on_hand'))
            AND (kind = 'toll') = (trip_expense_id IS NOT NULL)`,
  });
  pgm.createIndex(FASTAG_ENTRY, ['vehicle_id', 'occurred_on']);
  isolate(pgm, 'fleet', 'fastag_entry', 'SELECT, INSERT');
  pgm.sql('REVOKE UPDATE, DELETE ON fleet.fastag_entry FROM morbeez_app');

  pgm.addColumns(EXPENSE, { paid_by: { type: 'text', notNull: true, default: 'cash' } });
  pgm.addConstraint(EXPENSE, 'trip_expense_paid_by_valid', {
    check: `paid_by IN ('cash', 'fastag') AND (paid_by = 'cash' OR category IN ('toll', 'parking'))`,
  });

  pgm.sql(`
    INSERT INTO money.ledger_account (code, name, root_type, number, report_group, is_system, is_control) VALUES
      ('fastag_balance', 'FASTag balance', 'asset', 1060, 'current_asset', true, true)
    ON CONFLICT (code) DO NOTHING
  `);
  pgm.sql('SELECT money.install_chart_of_accounts(id) FROM tenant.tenant');

  // ---- 3. Integrations ----
  pgm.createTable(INTEGRATION, {
    tenant_id: { ...tenantColumn, primaryKey: true },
    // Meta's id for the business's WhatsApp number (WhatsApp Manager → API setup).
    whatsapp_phone_number_id: { type: 'text', unique: true },
    // Answer each order message with what was understood.
    whatsapp_reply: { type: 'boolean', notNull: true, default: false },
    // The owner may have a customer called by the automated voice.
    calls_enabled: { type: 'boolean', notNull: true, default: false },
    version: { type: 'integer', notNull: true, default: 1 },
    updated_by: userColumn,
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(INTEGRATION, 'integration_setting_valid', {
    check: "whatsapp_phone_number_id IS NULL OR whatsapp_phone_number_id ~ '^[0-9]{5,30}$'",
  });
  isolate(pgm, 'tenant', 'integration_setting', 'SELECT, INSERT, UPDATE');

  pgm.createTable(INBOUND, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    channel: { type: 'text', notNull: true, default: 'whatsapp' },
    provider_message_id: { type: 'text', notNull: true },
    // As the channel gives it: digits with the country code.
    from_phone: { type: 'text', notNull: true },
    sender_name: { type: 'text' },
    customer_id: customerColumn,
    message_type: { type: 'text', notNull: true },
    body: { type: 'text', notNull: true, default: '' },
    received_at: { type: 'timestamptz', notNull: true },
    status: { type: 'text', notNull: true, default: 'received' },
    // claude or rules: what read it.
    reader: { type: 'text' },
    // What was read, before it was checked against the product list.
    extraction: { type: 'jsonb' },
    recommendation_id: { type: 'uuid', references: { schema: 'ai', name: 'recommendation' }, onDelete: 'RESTRICT' },
    // Why nothing came of it, or what went wrong — in plain words.
    note: { type: 'text' },
    replied_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(INBOUND, 'inbound_message_valid', {
    check: `channel IN ('whatsapp') AND status IN (${list(MESSAGE_STATUSES)})
            AND (reader IS NULL OR reader IN ('claude', 'rules'))
            AND (status = 'suggested') = (recommendation_id IS NOT NULL)
            AND length(body) <= 4096`,
  });
  pgm.addConstraint(INBOUND, 'inbound_message_once', { unique: ['tenant_id', 'channel', 'provider_message_id'] });
  pgm.createIndex(INBOUND, ['tenant_id', 'received_at']);
  isolate(pgm, 'ai', 'inbound_message', 'SELECT, INSERT, UPDATE');

  pgm.createTable(CALL, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    customer_id: { ...customerColumn, notNull: true },
    purpose: { type: 'text', notNull: true },
    language: { type: 'text', notNull: true },
    to_phone: { type: 'text', notNull: true },
    // The numbers the call says, fixed when it was placed: {"amount", "orderNumber", "lines"}.
    script: { type: 'jsonb', notNull: true },
    order_id: { type: 'uuid', references: { schema: 'commerce', name: 'customer_order' }, onDelete: 'RESTRICT' },
    provider_call_sid: { type: 'text', unique: true },
    status: { type: 'text', notNull: true, default: 'queued' },
    // 1 → confirmed, 2 → asked to be called back; none when nothing was pressed.
    digits: { type: 'text' },
    outcome: { type: 'text' },
    answered_at: { type: 'timestamptz' },
    ended_at: { type: 'timestamptz' },
    duration_seconds: { type: 'integer' },
    error: { type: 'text' },
    requested_by: { ...userColumn, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(CALL, 'voice_call_valid', {
    check: `purpose IN (${list(CALL_PURPOSES)}) AND status IN (${list(CALL_STATUSES)})
            AND language IN ('en', 'ml', 'kn', 'ta') AND jsonb_typeof(script) = 'object'
            AND (outcome IS NULL OR outcome IN ('confirmed', 'callback', 'no_response'))
            AND (purpose <> 'order_confirm' OR order_id IS NOT NULL)
            AND (duration_seconds IS NULL OR duration_seconds >= 0)`,
  });
  pgm.createIndex(CALL, ['tenant_id', 'created_at']);
  pgm.createIndex(CALL, ['tenant_id', 'customer_id', 'created_at']);
  isolate(pgm, 'ai', 'voice_call', 'SELECT, INSERT, UPDATE');

  // The providers' webhooks: which business a WhatsApp number or a call
  // belongs to, and nothing else.
  pgm.sql(`
    CREATE FUNCTION tenant.find_tenant_for_whatsapp(p_phone_number_id text) RETURNS uuid
    SECURITY DEFINER
    SET search_path = tenant, pg_temp
    LANGUAGE sql
    STABLE
    AS $$
      SELECT tenant_id FROM tenant.integration_setting WHERE whatsapp_phone_number_id = p_phone_number_id;
    $$
  `);
  pgm.sql('REVOKE ALL ON FUNCTION tenant.find_tenant_for_whatsapp(text) FROM PUBLIC');
  pgm.sql('GRANT EXECUTE ON FUNCTION tenant.find_tenant_for_whatsapp(text) TO morbeez_app');
  pgm.sql('CREATE POLICY integration_setting_definer_lookup ON tenant.integration_setting FOR SELECT TO CURRENT_USER USING (true)');
  pgm.sql(`
    CREATE FUNCTION ai.find_tenant_for_call(p_call_id uuid) RETURNS uuid
    SECURITY DEFINER
    SET search_path = ai, pg_temp
    LANGUAGE sql
    STABLE
    AS $$
      SELECT tenant_id FROM ai.voice_call WHERE id = p_call_id;
    $$
  `);
  pgm.sql('REVOKE ALL ON FUNCTION ai.find_tenant_for_call(uuid) FROM PUBLIC');
  pgm.sql('GRANT EXECUTE ON FUNCTION ai.find_tenant_for_call(uuid) TO morbeez_app');
  pgm.sql('CREATE POLICY voice_call_definer_lookup ON ai.voice_call FOR SELECT TO CURRENT_USER USING (true)');

  // ---- 4. Runs from a WhatsApp message ----
  pgm.addColumns(RUN, { source: { type: 'text', notNull: true, default: 'owner' } });
  pgm.alterColumn(RUN, 'created_by', { notNull: false });
  pgm.addConstraint(RUN, 'run_source_valid', { check: "source IN ('owner', 'whatsapp') AND (source = 'owner') = (created_by IS NOT NULL)" });

  // ---- 5. Alerts ----
  pgm.dropConstraint(ALERT, 'owner_alert_valid');
  pgm.addConstraint(ALERT, 'owner_alert_valid', { check: `severity IN ('critical', 'warning') AND kind IN (${list(ALERT_KINDS)})` });
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM tenant.owner_alert WHERE kind IN ('driver_request', 'fastag_low')`);
  pgm.dropConstraint(ALERT, 'owner_alert_valid');
  pgm.addConstraint(ALERT, 'owner_alert_valid', { check: `severity IN ('critical', 'warning') AND kind IN (${list(OLD_ALERT_KINDS)})` });

  pgm.dropTable(INBOUND); // before the runs and suggestions it points at
  pgm.sql(`DELETE FROM ai.recommendation_decision WHERE recommendation_id IN
             (SELECT r.id FROM ai.recommendation r JOIN ai.run u ON u.id = r.run_id WHERE u.source = 'whatsapp')`);
  pgm.sql(`DELETE FROM ai.recommendation WHERE run_id IN (SELECT id FROM ai.run WHERE source = 'whatsapp')`);
  pgm.sql(`DELETE FROM ai.run WHERE source = 'whatsapp'`);
  pgm.dropConstraint(RUN, 'run_source_valid');
  pgm.alterColumn(RUN, 'created_by', { notNull: true });
  pgm.dropColumns(RUN, ['source']);

  pgm.sql('DROP POLICY voice_call_definer_lookup ON ai.voice_call');
  pgm.sql('DROP FUNCTION ai.find_tenant_for_call(uuid)');
  pgm.sql('DROP POLICY integration_setting_definer_lookup ON tenant.integration_setting');
  pgm.sql('DROP FUNCTION tenant.find_tenant_for_whatsapp(text)');
  pgm.dropTable(CALL);
  pgm.dropTable(INTEGRATION);

  pgm.dropTable(FASTAG_ENTRY); // refuses once anything's posted to the tag; reverse those entries first
  pgm.dropTable(FASTAG);
  pgm.dropConstraint(EXPENSE, 'trip_expense_paid_by_valid');
  pgm.dropColumns(EXPENSE, ['paid_by']);
  pgm.sql("DELETE FROM money.account WHERE code = 'fastag_balance'");
  pgm.sql("DELETE FROM money.ledger_account WHERE code = 'fastag_balance'");

  pgm.dropTable(REQUEST);
};
