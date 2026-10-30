'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { ChatConversation, ChatMessage } from '@morbeez/shared-types';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { Icon } from '@/components/ui/Icon';
import { initialsOf } from '@/components/redesign/Party';
import { apiSend, apiUpload } from '@/lib/api/client';
import { CHAT_KEY, useChatThread, useConversations } from '@/lib/hooks/use-chat';
import { useTenantProfile } from '@/lib/hooks/use-lookups';
import { displayLogin } from '@/lib/phone';
import { formatDateTime, timeOf } from '@/lib/format';
import { useT } from '@/lib/i18n';

/**
 * Chat with drivers (driver app D9; the client's answer 9): every driver's
 * conversation with the business — the last word and what's unread — and
 * one conversation: messages and photos, each perhaps about a trip, and a
 * reply. ?driver=<employeeId>&trip=<tripId> opens one about a trip.
 */
export default function ChatPage() {
  const t = useT();
  const params = useSearchParams();
  const [open, setOpen] = useState<string | null>(params.get('driver'));
  const list = useConversations();
  useEffect(() => {
    const driver = params.get('driver');
    if (driver) setOpen(driver);
  }, [params]);

  return (
    <div className="chat-layout" data-open={open ? 'thread' : 'list'}>
      <section className="chat-list" aria-label={t('Drivers')}>
        <h1 className="page-title visually-hidden">{t('Chat with drivers')}</h1>
        {list.isPending ? (
          <SkeletonLines lines={5} />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.length === 0 ? (
          <p className="muted">{t('No drivers yet.')}</p>
        ) : (
          list.data.map((c) => <ConversationRow key={c.employeeId} c={c} selected={c.employeeId === open} onOpen={() => setOpen(c.employeeId)} />)
        )}
      </section>
      <section className="chat-thread">
        {open ? (
          <Thread key={open} employeeId={open} tripId={params.get('trip')} conversation={list.data?.find((c) => c.employeeId === open) ?? null} onBack={() => setOpen(null)} />
        ) : (
          <p className="muted chat-empty">{t('Choose a driver to read and write to them.')}</p>
        )}
      </section>
    </div>
  );
}

function ConversationRow({ c, selected, onOpen }: { c: ChatConversation; selected: boolean; onOpen: () => void }) {
  const t = useT();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const preview = c.last ? `${c.last.side === 'office' ? `${t('You')}: ` : ''}${c.last.body ?? t('Photo')}` : t('No messages yet');
  return (
    <button type="button" className="chat-row" aria-current={selected || undefined} onClick={onOpen}>
      <span className="party-avatar" aria-hidden="true">
        {initialsOf(c.name)}
      </span>
      <span className="chat-row-main">
        <span className="chat-row-name">
          {c.name}
          {c.onTrip && <span className="chat-trip-chip">{c.onTrip.number}</span>}
        </span>
        <span className="chat-row-preview">{preview}</span>
      </span>
      <span className="chat-row-side">
        {c.last && <span className="muted">{timeOf(c.last.writtenAt, timeZone)}</span>}
        {c.unread > 0 && <span className="nav-badge">{c.unread}</span>}
      </span>
    </button>
  );
}

function Thread({ employeeId, tripId, conversation, onBack }: { employeeId: string; tripId: string | null; conversation: ChatConversation | null; onBack: () => void }) {
  const t = useT();
  const client = useQueryClient();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const thread = useChatThread(employeeId);
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [aboutTrip, setAboutTrip] = useState<string>(tripId ?? conversation?.onTrip?.id ?? '');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const messages = thread.data?.messages ?? [];
  const latest = messages.reduce<string | null>((m, x) => (m === null || x.createdAt > m ? x.createdAt : m), null);

  // Opened, it's read: up to the latest message the server had.
  useEffect(() => {
    if (!thread.data || thread.data.unread === 0 || !latest) return;
    void apiSend('POST', `chat/conversations/${employeeId}/read`, { upTo: latest }).then(() => client.invalidateQueries({ queryKey: CHAT_KEY }));
  }, [thread.data, latest, employeeId, client]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const trips = [conversation?.onTrip, ...messages.filter((m) => m.tripId).map((m) => ({ id: m.tripId!, number: m.tripNumber! }))].filter(
    (x, i, xs): x is { id: string; number: string } => !!x && xs.findIndex((y) => y?.id === x.id) === i,
  );

  async function send() {
    if (!body.trim() && !photo) return;
    setSending(true);
    setProblem(null);
    try {
      const id = crypto.randomUUID();
      await apiSend('POST', `chat/conversations/${employeeId}`, { id, body: body.trim() || undefined, tripId: aboutTrip || undefined, photo: !!photo });
      if (photo) {
        const form = new FormData();
        form.append('file', photo);
        await apiUpload(`chat/messages/${id}/photo`, form);
      }
      setBody('');
      setPhoto(null);
      await client.invalidateQueries({ queryKey: CHAT_KEY });
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-panel">
      <header className="chat-head">
        <button type="button" className="icon-button chat-back" onClick={onBack} aria-label={t('Back')}>
          <Icon name="back" />
        </button>
        <span className="party-avatar" aria-hidden="true">
          {initialsOf(thread.data?.driver.name ?? conversation?.name ?? '')}
        </span>
        <span className="chat-head-main">
          <strong>{thread.data?.driver.name ?? conversation?.name}</strong>
          <span className="muted">
            {[conversation?.phone ? displayLogin(conversation.phone) : null, conversation?.onTrip ? t('On trip {n}', { n: conversation.onTrip.number }) : null].filter(Boolean).join(' · ')}
          </span>
        </span>
        {conversation?.phone && (
          <a className="button button-small" href={`tel:${conversation.phone}`}>
            <Icon name="phone" size={16} /> {t('Call')}
          </a>
        )}
      </header>
      <div className="chat-messages" aria-live="polite">
        {thread.isPending ? (
          <SkeletonLines lines={4} />
        ) : thread.error ? (
          <ErrorState error={thread.error} onRetry={() => thread.refetch()} />
        ) : messages.length === 0 ? (
          <p className="muted chat-empty">{t('No messages yet — say hello.')}</p>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} timeZone={timeZone} />)
        )}
        <div ref={end} />
      </div>
      <div className="chat-compose">
        {trips.length > 0 && (
          <label className="chat-about">
            <span className="muted">{t('About')}</span>
            <select value={aboutTrip} onChange={(e) => setAboutTrip(e.target.value)}>
              <option value="">{t('No trip')}</option>
              {trips.map((x) => (
                <option key={x.id} value={x.id}>
                  {t('Trip {n}', { n: x.number })}
                </option>
              ))}
            </select>
          </label>
        )}
        <textarea
          aria-label={t('Message')}
          placeholder={t('Write to {name}…', { name: thread.data?.driver.name ?? conversation?.name ?? '' })}
          value={body}
          rows={2}
          maxLength={2000}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="chat-compose-actions">
          <label className="button button-small chat-photo-button">
            <Icon name="camera" size={16} /> {photo ? photo.name : t('Photo')}
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </label>
          <button type="button" className="button button-primary" disabled={sending || (!body.trim() && !photo)} onClick={() => void send()}>
            {t(sending ? 'Sending…' : 'Send')}
          </button>
        </div>
        {problem && (
          <p className="form-error" role="alert">
            {problem}
          </p>
        )}
      </div>
    </div>
  );
}

function Bubble({ m, timeZone }: { m: ChatMessage; timeZone: string }) {
  const t = useT();
  return (
    <div className="chat-bubble" data-side={m.side}>
      {m.photo === 'ready' && (
        <a href={`/api/backend/chat/messages/${m.id}/photo`} target="_blank" rel="noreferrer">
          <img className="chat-photo" src={`/api/backend/chat/messages/${m.id}/photo`} alt={t('Photo from {name}', { name: m.senderName })} />
        </a>
      )}
      {m.photo === 'pending' && <span className="muted chat-photo-pending">{t('Photo on its way…')}</span>}
      {m.body && <span className="chat-body">{m.body}</span>}
      <span className="chat-meta">
        {m.side === 'office' ? m.senderName : null}
        {m.side === 'office' ? ' · ' : ''}
        <span title={formatDateTime(m.writtenAt, timeZone)}>{timeOf(m.writtenAt, timeZone)}</span>
        {m.tripId && (
          <>
            {' · '}
            <Link href={`/logistics?open=${m.tripId}`}>{m.tripNumber}</Link>
          </>
        )}
      </span>
    </div>
  );
}
