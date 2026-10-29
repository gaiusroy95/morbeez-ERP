'use client';

import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useT } from '@/lib/i18n';
import type { CardTone } from './ListCards';

/**
 * The pieces of the client's Customers and Farmers screens (V1.1, screens
 * 10–12): a card per customer or farmer, a profile header, the Call /
 * WhatsApp / Navigate row, and the figure tiles.
 */

/** "Ramesh Farm" → "RF". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : (words[0]?.[1] ?? ''))).toUpperCase();
}

export function PartyCard({
  name,
  sub,
  detail,
  amount,
  amountNote,
  amountTone,
  rating,
  status,
  tone,
  selected,
  onOpen,
}: {
  name: string;
  /** "Mysuru North" or "Nanjangud · Ginger". */
  sub?: string | null;
  detail?: ReactNode;
  /** The big figure on the right (sales, purchases). */
  amount?: string | null;
  /** Under it ("Balance: ₹70,000", "Due ₹20,000"). */
  amountNote?: string | null;
  amountTone?: 'bad' | 'good';
  rating?: number | null;
  status?: string | null;
  tone?: CardTone;
  selected?: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <button type="button" className="party-card" aria-current={selected || undefined} onClick={onOpen}>
      <span className="party-avatar" aria-hidden="true">
        {initialsOf(name)}
      </span>
      <span className="party-main">
        <span className="party-name">{name}</span>
        {sub && <span className="party-sub">{sub}</span>}
        {detail && <span className="party-detail">{detail}</span>}
      </span>
      <span className="party-side">
        {rating !== undefined && rating !== null && (
          <span className="party-rating" aria-label={t('Score {n} of 5', { n: rating.toFixed(1) })}>
            ★ {rating.toFixed(1)}
          </span>
        )}
        {amount && <span className="party-amount">{amount}</span>}
        {amountNote && (
          <span className="party-amount-note" data-tone={amountTone}>
            {amountNote}
          </span>
        )}
        {status && (
          <span className="list-card-status" data-tone={tone}>
            {t(status)}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * Avatar, rating, "Mysuru North · Since 2023", status — under the panel's
 * title, which is the name (shown here too when [showName]).
 */
export function ProfileHead({
  name,
  sub,
  rating,
  status,
  tone,
  showName = false,
}: {
  name: string;
  sub?: string | null;
  rating?: number | null;
  status: string;
  tone: CardTone;
  showName?: boolean;
}) {
  const t = useT();
  return (
    <div className="profile-head">
      <span className="party-avatar party-avatar-large" aria-hidden="true">
        {initialsOf(name)}
      </span>
      <span className="party-main">
        {(showName || (rating !== undefined && rating !== null)) && (
          <span className="profile-name">
            {showName && name}
            {rating !== undefined && rating !== null && <span className="party-rating"> ★ {rating.toFixed(1)} / 5</span>}
          </span>
        )}
        {sub && <span className="party-sub">{sub}</span>}
      </span>
      <span className="list-card-status" data-tone={tone}>
        {t(status)}
      </span>
    </div>
  );
}

/** A mobile number as dialled from India: "+91…" for a 10-digit number. */
function international(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits.length >= 8 ? digits : null;
}

/** Call, WhatsApp, Navigate — each disabled when there's no number or place to go to. */
export function ContactActions({
  phone,
  pin,
  address,
}: {
  phone: string | null | undefined;
  pin: { latitude: string; longitude: string } | null;
  /** Used to search the map when there's no pin. */
  address: string | null;
}) {
  const t = useT();
  const number = phone ? international(phone) : null;
  const navigate = pin
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${pin.latitude},${pin.longitude}`)}`
    : address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
      : null;
  const item = (href: string | null, icon: 'phone' | 'chat' | 'navigate', label: string, external: boolean) =>
    href ? (
      <a className="contact-action" href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        <Icon name={icon} size={20} />
        {t(label)}
      </a>
    ) : (
      <span className="contact-action" aria-disabled="true">
        <Icon name={icon} size={20} />
        {t(label)}
      </span>
    );
  return (
    <div className="contact-actions">
      {item(number ? `tel:+${number}` : null, 'phone', 'Call', false)}
      {item(number ? `https://wa.me/${number}` : null, 'chat', 'WhatsApp', true)}
      {item(navigate, 'navigate', 'Navigate', true)}
    </div>
  );
}

/** A grid of labelled figures (Total Sales, Outstanding, …). */
export function StatTiles({ items }: { items: { label: string; value: ReactNode; tone?: 'bad' | 'good' }[] }) {
  const t = useT();
  return (
    <div className="stat-tiles">
      {items.map((item) => (
        <div key={item.label} className="stat-tile" data-tone={item.tone}>
          <span className="stat-tile-label">{t(item.label)}</span>
          <strong className="stat-tile-value">{item.value}</strong>
        </div>
      ))}
    </div>
  );
}
