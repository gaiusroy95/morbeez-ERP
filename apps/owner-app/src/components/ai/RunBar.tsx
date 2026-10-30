'use client';

import type { AiRecommendationType } from '@morbeez/shared-types';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useLastRun } from '@/lib/hooks/use-ai';
import { useTenantProfile } from '@/lib/hooks/use-lookups';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/i18n';

/** "Get fresh suggestions": computing changes nothing (AI System DR.1). */
export function FreshButton() {
  const t = useT();
  const refresh = useAction(() => apiSend('POST', 'ai/runs', {}), [KEYS.ai]);
  return (
    <button type="button" className="button button-primary" disabled={refresh.isPending} onClick={() => refresh.mutate(undefined)}>
      {t(refresh.isPending ? 'Working it out…' : 'Get fresh suggestions')}
    </button>
  );
}

/** When the suggestions were last worked out — and, for [type], why none, if none. */
export function RunNote({ type }: { type: AiRecommendationType }) {
  const t = useT();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const run = useLastRun().data;
  const why = run?.suppressed[type];
  return (
    <p className="muted run-note" role="status">
      {run ? t('Last worked out {when}.', { when: formatDateTime(run.finishedAt, timeZone) }) : t('No suggestions worked out yet.')}
      {why ? ` ${t('None now: {why}', { why })}` : ''}
    </p>
  );
}
