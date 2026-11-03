'use client';

import { useState } from 'react';
import type { IntegrationsStatus } from '@morbeez/shared-types';
import { Field } from '@/components/ui/Form';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useIntegrations } from '@/lib/hooks/use-ai';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { useT } from '@/lib/i18n';

function Ready({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return <StatusBadge status={on ? 'set_up' : 'not_set_up'} label={on ? onLabel : offLabel} tone={on ? 'done' : 'muted'} />;
}

/**
 * Settings → Integrations: the outside services this server has keys for —
 * WhatsApp for customers' orders, Sarvam AI to read them, Sarvam's voice
 * agent for AI calls (set by whoever runs the server: apps/backend/.env.example)
 * — and the business's own choices: which WhatsApp number is its own, whether
 * customers get a reply, whether AI calls may be placed.
 */
export function Integrations() {
  const t = useT();
  const { data: session } = useSession();
  const status = useIntegrations();
  if (status.isPending) return <SkeletonLines lines={8} />;
  if (status.error || !status.data) return <ErrorState error={status.error} onRetry={() => status.refetch()} />;
  const s = status.data;
  return (
    <>
      <Panel title={t('What this server is set up for')}>
        <ul className="integration-list">
          <li>
            <strong>{t('WhatsApp orders')}</strong>
            <Ready on={s.whatsapp.receives} onLabel="Receiving" offLabel="Not set up" />
            <p className="muted">
              {s.whatsapp.receives
                ? t('Customers’ messages to your WhatsApp number arrive on AI Orders. {n} in the last 7 days.', { n: s.whatsapp.messagesLast7Days })
                : t('Needs WHATSAPP_VERIFY_TOKEN and WHATSAPP_APP_SECRET on the server (.env.example, section 4b).')}
            </p>
            {s.whatsapp.webhookUrl && (
              <p className="muted">
                {t('Webhook URL for Meta')}: <code>{s.whatsapp.webhookUrl}</code>
              </p>
            )}
          </li>
          <li>
            <strong>{t('Replies on WhatsApp')}</strong>
            <Ready on={s.whatsapp.replies} onLabel="Can reply" offLabel="Not set up" />
            <p className="muted">{s.whatsapp.replies ? t('Customers can be told what was understood.') : t('Needs WHATSAPP_ACCESS_TOKEN on the server.')}</p>
          </li>
          <li>
            <strong>{t('Reading orders')}</strong>
            <Ready on={s.reader.sarvam} onLabel="Sarvam AI" offLabel="Simple rules" />
            <p className="muted">
              {s.reader.sarvam
                ? t('Sarvam AI ({model}) reads orders in Malayalam, Kannada, Tamil or English, any script, with local product names. You check each one before it is placed.', { model: s.reader.model ?? '' })
                : t('Without SARVAM_API_KEY, simple rules read messages like “Tomato 20 kg, onion 15 kg” — nothing in another script.')}
            </p>
          </li>
          <li>
            <strong>{t('AI calls')}</strong>
            <Ready on={s.calls.ready} onLabel="Can call" offLabel="Not set up" />
            <p className="muted">
              {s.calls.ready
                ? t('Calls come from {number}. {n} placed in the last 7 days.', { number: s.calls.fromNumber ?? '', n: s.calls.callsLast7Days })
                : t('Needs a Sarvam Voice Agents workspace with the agent set up (SARVAM_VOICE_… settings) and PUBLIC_API_URL on the server (.env.example, sections 4a and 4d).')}
            </p>
          </li>
        </ul>
      </Panel>
      {hasPermission(session, 'tenant:manage') ? <ChoicesForm s={s} /> : <p className="muted">{t('Only the owner changes these.')}</p>}
    </>
  );
}

function ChoicesForm({ s }: { s: IntegrationsStatus }) {
  const t = useT();
  const [phoneNumberId, setPhoneNumberId] = useState(s.settings.whatsappPhoneNumberId ?? '');
  const [reply, setReply] = useState(s.settings.whatsappReply);
  const [calls, setCalls] = useState(s.settings.callsEnabled);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useAction(
    () =>
      apiSend<IntegrationsStatus>('PUT', 'integrations/settings', {
        version: s.settings.version,
        whatsappPhoneNumberId: phoneNumberId.trim() || null,
        whatsappReply: reply,
        callsEnabled: calls,
      }),
    [KEYS.ai],
    () => setSaved(true),
  );
  return (
    <Panel title={t('Your choices')}>
      <form
        className="form-grid"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          if (phoneNumberId.trim() && !/^\d{5,30}$/.test(phoneNumberId.trim())) return setProblem(t('The phone number ID is the long number Meta shows, digits only.'));
          setProblem(null);
          save.mutate(undefined);
        }}
      >
        <Field label={t('WhatsApp phone number ID')} hint={t('Meta: WhatsApp → API Setup, under your number. It ties the number to your business.')} wide>
          {(props) => <input {...props} inputMode="numeric" value={phoneNumberId} placeholder="1098765432…" onChange={(e) => setPhoneNumberId(e.target.value)} />}
        </Field>
        <label className="check-row" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={reply} onChange={(e) => setReply(e.target.checked)} />
          <span>{t('Reply to each order message with what was understood, in the customer’s language')}</span>
        </label>
        <label className="check-row" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={calls} onChange={(e) => setCalls(e.target.checked)} />
          <span>{t('Allow AI calls to customers from AI Calling')}</span>
        </label>
        {(problem || save.error) && (
          <p className="form-error" role="alert" style={{ gridColumn: '1 / -1' }}>
            {problem ?? (save.error as Error).message}
          </p>
        )}
        {saved && !save.isPending && (
          <p className="muted" role="status" style={{ gridColumn: '1 / -1' }}>
            {t('Saved.')}
          </p>
        )}
        <div style={{ gridColumn: '1 / -1' }}>
          <button type="submit" className="button button-primary" disabled={save.isPending}>
            {t('Save')}
          </button>
        </div>
      </form>
    </Panel>
  );
}
