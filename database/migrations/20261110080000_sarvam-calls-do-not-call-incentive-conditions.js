/* eslint-disable camelcase */

// The client's answers (2 Nov 2026), on top of 20261109080000 as it shipped:
//
// 1. Sarvam AI reads WhatsApp orders instead of Claude (ai.inbound_message.
//    reader 'sarvam'; 'claude' stays valid for messages read before).
// 2. Replies to customers are on unless the owner turns them off
//    (integration_setting.whatsapp_reply defaults to true; a business that
//    already saved its choice keeps it).
// 3. AI calls are a conversation with Sarvam's voice agent, not Twilio's
//    press 1 / press 2. ai.voice_call keeps what the agent was told (brief,
//    the old script column renamed), the follow-up's topic, Sarvam's attempt
//    and conversation ids, and what came back: the agent's outcome, a
//    summary, everything it collected (details), the transcript. Sarvam's
//    webhook isn't signed, so each call has its own token, carried in the
//    URL it's given. Five kinds of call. A call Twilio left ringing or under
//    way will never be reported now: it's failed; 'callback' and
//    'no_response' become the agent's 'call_later' and 'no_decision'; a key
//    pressed is kept in details.
// 4. A customer may be marked Do Not Call (trading_partners.customer.do_not_call).
// 5. The driver incentives' eligibility conditions, the owner's to change
//    (workforce.driver_incentive_settings.conditions; the engine's defaults
//    for any not set).

exports.shorthands = undefined;

const INTEGRATION = { schema: 'tenant', name: 'integration_setting' };
const INBOUND = { schema: 'ai', name: 'inbound_message' };
const CALL = { schema: 'ai', name: 'voice_call' };
const CUSTOMER = { schema: 'trading_partners', name: 'customer' };
const INCENTIVES = { schema: 'workforce', name: 'driver_incentive_settings' };

const MESSAGE_STATUSES = ['received', 'suggested', 'no_customer', 'no_order', 'not_text', 'failed'];
const CALL_PURPOSES = ['payment_reminder', 'order_reminder', 'order_confirm', 'quantity_confirm', 'follow_up'];
const CALL_STATUSES = ['queued', 'completed', 'no_answer', 'busy', 'failed'];
const CALL_OUTCOMES = ['confirmed', 'change_requested', 'will_pay', 'already_paid', 'call_later', 'not_interested', 'wrong_person', 'no_decision'];
const OLD_CALL_PURPOSES = ['payment_reminder', 'order_reminder', 'order_confirm'];
const OLD_CALL_STATUSES = ['queued', 'ringing', 'in_progress', 'completed', 'busy', 'no_answer', 'failed', 'canceled'];
const list = (xs) => xs.map((x) => `'${x}'`).join(', ');

const inboundCheck = (readers) => `channel IN ('whatsapp') AND status IN (${list(MESSAGE_STATUSES)})
            AND (reader IS NULL OR reader IN (${list(readers)}))
            AND (status = 'suggested') = (recommendation_id IS NOT NULL)
            AND length(body) <= 4096`;

exports.up = (pgm) => {
  // ---- 1. Sarvam AI reads the messages ----
  pgm.dropConstraint(INBOUND, 'inbound_message_valid');
  pgm.addConstraint(INBOUND, 'inbound_message_valid', { check: inboundCheck(['sarvam', 'rules', 'claude']) });

  // ---- 2. Replies on by default ----
  pgm.alterColumn(INTEGRATION, 'whatsapp_reply', { default: true });

  // ---- 3. AI calls: Sarvam's voice agent ----
  pgm.dropConstraint(CALL, 'voice_call_valid');
  pgm.renameColumn(CALL, 'script', 'brief');
  pgm.renameColumn(CALL, 'provider_call_sid', 'provider_attempt_id');
  pgm.sql('ALTER TABLE ai.voice_call RENAME CONSTRAINT voice_call_provider_call_sid_key TO voice_call_provider_attempt_id_key');
  pgm.addColumns(CALL, {
    // A follow-up: what the owner wants the agent to talk about.
    topic: { type: 'text' },
    // Sarvam's id for the conversation, once it connected.
    interaction_id: { type: 'text' },
    // What came back: a one-line summary, everything the agent collected
    // (its final variables), and the conversation turn by turn.
    summary: { type: 'text' },
    details: { type: 'jsonb' },
    transcript: { type: 'jsonb' },
    // Sarvam's webhook isn't signed: its URL carries this, checked on arrival.
    webhook_token: { type: 'text' },
  });
  // FORCE ROW LEVEL SECURITY would hide every row from a non-superuser
  // owner (RDS, Neon), so it's lifted around the backfill.
  pgm.sql('ALTER TABLE ai.voice_call NO FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    UPDATE ai.voice_call SET
      status = CASE WHEN status IN ('ringing', 'in_progress', 'canceled') THEN 'failed' ELSE status END,
      error = CASE WHEN status IN ('ringing', 'in_progress', 'canceled') THEN COALESCE(error, 'An automated call from before AI calls; it was never reported') ELSE error END,
      outcome = CASE outcome WHEN 'callback' THEN 'call_later' WHEN 'no_response' THEN 'no_decision' ELSE outcome END,
      details = CASE WHEN digits IS NOT NULL THEN jsonb_build_object('digits', digits) END,
      webhook_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  `);
  pgm.sql('ALTER TABLE ai.voice_call FORCE ROW LEVEL SECURITY');
  pgm.alterColumn(CALL, 'webhook_token', { notNull: true });
  pgm.dropColumns(CALL, ['digits', 'answered_at']);
  pgm.addConstraint(CALL, 'voice_call_valid', {
    check: `purpose IN (${list(CALL_PURPOSES)}) AND status IN (${list(CALL_STATUSES)})
            AND language IN ('en', 'ml', 'kn', 'ta') AND jsonb_typeof(brief) = 'object'
            AND (outcome IS NULL OR outcome IN (${list(CALL_OUTCOMES)}))
            AND (purpose NOT IN ('order_confirm', 'quantity_confirm') OR order_id IS NOT NULL)
            AND (purpose <> 'follow_up' OR length(btrim(topic)) > 0)
            AND (transcript IS NULL OR jsonb_typeof(transcript) = 'array')
            AND (duration_seconds IS NULL OR duration_seconds >= 0)
            AND length(webhook_token) >= 32`,
  });

  // ---- 4. Do Not Call ----
  pgm.addColumns(CUSTOMER, { do_not_call: { type: 'boolean', notNull: true, default: false } });

  // ---- 5. Incentive eligibility conditions ----
  // {"minCollected", "minCrates", "qualityShortAllowed", "performanceSkipsAllowed",
  //  "dataQualityNeeds": {"km", "deliveryPhotos", "bills"}, "completionOnException"}
  pgm.addColumns(INCENTIVES, { conditions: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") } });
  pgm.addConstraint(INCENTIVES, 'driver_incentive_conditions_valid', { check: "jsonb_typeof(conditions) = 'object'" });
};

exports.down = (pgm) => {
  pgm.dropConstraint(INCENTIVES, 'driver_incentive_conditions_valid');
  pgm.dropColumns(INCENTIVES, ['conditions']);
  pgm.dropColumns(CUSTOMER, ['do_not_call']);

  // The calls the old ones can't describe go; the rest go back to Twilio's shape.
  pgm.dropConstraint(CALL, 'voice_call_valid');
  pgm.sql('ALTER TABLE ai.voice_call NO FORCE ROW LEVEL SECURITY');
  pgm.sql(`DELETE FROM ai.voice_call WHERE purpose NOT IN (${list(OLD_CALL_PURPOSES)})`);
  pgm.addColumns(CALL, { digits: { type: 'text' }, answered_at: { type: 'timestamptz' } });
  pgm.sql(`
    UPDATE ai.voice_call SET
      digits = details->>'digits',
      outcome = CASE outcome WHEN 'call_later' THEN 'callback' WHEN 'no_decision' THEN 'no_response' WHEN 'confirmed' THEN 'confirmed' END
  `);
  pgm.sql('ALTER TABLE ai.voice_call FORCE ROW LEVEL SECURITY');
  pgm.dropColumns(CALL, ['topic', 'interaction_id', 'summary', 'details', 'transcript', 'webhook_token']);
  pgm.sql('ALTER TABLE ai.voice_call RENAME CONSTRAINT voice_call_provider_attempt_id_key TO voice_call_provider_call_sid_key');
  pgm.renameColumn(CALL, 'provider_attempt_id', 'provider_call_sid');
  pgm.renameColumn(CALL, 'brief', 'script');
  pgm.addConstraint(CALL, 'voice_call_valid', {
    check: `purpose IN (${list(OLD_CALL_PURPOSES)}) AND status IN (${list(OLD_CALL_STATUSES)})
            AND language IN ('en', 'ml', 'kn', 'ta') AND jsonb_typeof(script) = 'object'
            AND (outcome IS NULL OR outcome IN ('confirmed', 'callback', 'no_response'))
            AND (purpose <> 'order_confirm' OR order_id IS NOT NULL)
            AND (duration_seconds IS NULL OR duration_seconds >= 0)`,
  });

  pgm.alterColumn(INTEGRATION, 'whatsapp_reply', { default: false });

  // Messages Sarvam read are kept: the readers' check stays wide enough for them.
  pgm.dropConstraint(INBOUND, 'inbound_message_valid');
  pgm.addConstraint(INBOUND, 'inbound_message_valid', { check: inboundCheck(['claude', 'rules', 'sarvam']) });
};
