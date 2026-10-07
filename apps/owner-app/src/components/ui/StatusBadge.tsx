'use client';

import { useT } from '@/lib/i18n';

// One badge for every workflow status in the app. Tone carries the
// meaning (needs attention / in motion / done / stopped); the label always
// says it in words, so colour is never the only signal.

export type Tone = 'attention' | 'active' | 'done' | 'muted' | 'bad';

const STATUS: Record<string, { label: string; tone: Tone }> = {
  // orders
  placed: { label: 'To confirm', tone: 'attention' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'attention' },
  confirmed: { label: 'Confirmed', tone: 'active' },
  delivered: { label: 'Delivered', tone: 'done' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  // purchase orders
  received: { label: 'Received', tone: 'attention' },
  graded: { label: 'Graded', tone: 'done' },
  closed: { label: 'Closed', tone: 'muted' },
  // lots
  received_ungraded: { label: 'Ungraded', tone: 'attention' },
  available: { label: 'Available', tone: 'active' },
  reserved: { label: 'Reserved', tone: 'active' },
  rejected: { label: 'Rejected', tone: 'bad' },
  // trips & stops
  planned: { label: 'Planned', tone: 'muted' },
  in_progress: { label: 'On the road', tone: 'active' },
  completed: { label: 'Completed', tone: 'done' },
  reconciled: { label: 'Closed', tone: 'done' },
  on_hold: { label: 'On hold', tone: 'attention' },
  pending: { label: 'Pending', tone: 'muted' },
  skipped: { label: 'Skipped', tone: 'bad' },
  scheduled: { label: 'Scheduled', tone: 'muted' },
  // master data
  active: { label: 'Active', tone: 'done' },
  archived: { label: 'Archived', tone: 'muted' },
};

export function StatusBadge({ status, tone, label }: { status: string; tone?: Tone; label?: string }) {
  const t = useT();
  const known = STATUS[status];
  return (
    <span className="badge" data-tone={tone ?? known?.tone ?? 'muted'}>
      {t(label ?? known?.label ?? status.replace(/_/g, ' '))}
    </span>
  );
}
