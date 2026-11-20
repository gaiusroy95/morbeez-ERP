'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CustomerRecord } from '@morbeez/shared-types';
import { apiUpload } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { Field } from '@/components/ui/Form';
import { Icon } from '@/components/ui/Icon';
import { parseLocation } from '@/lib/parse';
import { useT } from '@/lib/i18n';

/**
 * Taking a new customer down (the client, 20 Nov 2026): who to ask for, where
 * the shop is (GPS — its map pin, which route planning and the driver's stop
 * read), the landmark a driver looks for, and a photo of the shop's front.
 */

/** Google Maps at a point. */
export function mapsLink(latitude: number | string, longitude: number | string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

/** The shop's photo as the owner app serves it; the time makes a new photo show at once. */
export function shopPhotoUrl(customer: Pick<CustomerRecord, 'id' | 'shopPhoto'>): string | null {
  return customer.shopPhoto ? `/api/backend/customers/${customer.id}/shop-photo?v=${encodeURIComponent(String(customer.shopPhoto.uploadedAt))}` : null;
}

type Finding = { kind: 'idle' } | { kind: 'finding' } | { kind: 'found'; accuracy: number } | { kind: 'failed'; message: string };

/** Where the shop is: this phone's GPS at the shop, typed, or pasted from Google Maps. */
export function LocationField({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const t = useT();
  const [finding, setFinding] = useState<Finding>({ kind: 'idle' });
  const parsed = parseLocation(value);
  const here = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setFinding({ kind: 'failed', message: t("This browser can't tell where it is — enter the location instead.") });
      return;
    }
    setFinding({ kind: 'finding' });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onChange(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`);
        setFinding({ kind: 'found', accuracy: Math.max(1, Math.round(p.coords.accuracy)) });
      },
      (e) =>
        setFinding({
          kind: 'failed',
          message:
            e.code === e.PERMISSION_DENIED
              ? t('Location is off or not allowed for this site — allow it, or enter the location.')
              : t("This phone couldn't find where it is — try again outside, or enter the location."),
        }),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  };
  return (
    <Field label="Location — GPS (optional)" hint="At the shop, tap “Use my location” — or type latitude, longitude, or paste a Google Maps link" wide>
      {(props) => (
        <div className="location-field">
          <div className="location-input">
            <input
              {...props}
              value={value}
              placeholder="12.3108, 76.6402"
              autoComplete="off"
              onChange={(e) => {
                setFinding({ kind: 'idle' });
                onChange(e.target.value);
              }}
            />
            <button type="button" className="button" onClick={here} disabled={finding.kind === 'finding'}>
              <Icon name="navigate" size={16} />
              {finding.kind === 'finding' ? t('Finding…') : t('Use my location')}
            </button>
          </div>
          {finding.kind === 'found' && (
            <span className="field-note" data-tone={finding.accuracy > 50 ? 'attention' : undefined}>
              {finding.accuracy > 50
                ? t('From this phone, to within {m} m — not exact; try again in the open', { m: finding.accuracy })
                : t('From this phone, to within {m} m', { m: finding.accuracy })}
            </span>
          )}
          {finding.kind === 'failed' && (
            <span className="field-note" data-tone="bad">
              {finding.message}
            </span>
          )}
          {parsed.ok && parsed.value && (
            <a className="field-note" href={mapsLink(parsed.value.latitude, parsed.value.longitude)} target="_blank" rel="noopener noreferrer">
              {t('Check it on Google Maps')}
            </a>
          )}
        </div>
      )}
    </Field>
  );
}

/** The shop's front: a photo taken now (or chosen), shown before it is sent. */
export function ShopPhotoField({ customer, file, onChange }: { customer?: CustomerRecord; file: File | null; onChange: (file: File | null) => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);
  const src = preview ?? (customer ? shopPhotoUrl(customer) : null);
  return (
    <Field label="Shop photo — front (optional)" hint="From the road, with the shop's name board in it" wide>
      {(props) => (
        <div className="shop-photo-field">
          {src && <img className="shop-photo" src={src} alt={t('Shop front')} />}
          {/* No `capture`: the phone offers its camera and its gallery. */}
          <input
            {...props}
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            className="visually-hidden"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          />
          <div className="shop-photo-actions">
            <button type="button" className="button" onClick={() => input.current?.click()}>
              <Icon name="camera" size={16} />
              {src ? t('Change photo') : t('Take photo')}
            </button>
            {file && (
              <button
                type="button"
                className="button button-ghost"
                onClick={() => {
                  onChange(null);
                  if (input.current) input.current.value = '';
                }}
              >
                {t('Remove')}
              </button>
            )}
          </div>
        </div>
      )}
    </Field>
  );
}

/** A phone photo made quick to send: at most 1600 px on its long side, as JPEG. Anything unreadable goes as it is. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 1_500_000 && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}

export async function uploadShopPhoto(customerId: string, file: File): Promise<CustomerRecord> {
  const blob = await shrink(file);
  const form = new FormData();
  form.append('file', blob, blob === file ? file.name : 'shop-front.jpg');
  return apiUpload<CustomerRecord>(`customers/${customerId}/shop-photo`, form);
}

/** On the customer's profile: the shop's front, or a way to add it. */
export function ShopPhoto({ customer, canEdit }: { customer: CustomerRecord; canEdit: boolean }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const upload = useAction((file: File) => uploadShopPhoto(customer.id, file), [KEYS.customers, KEYS.lookupCustomers]);
  const url = shopPhotoUrl(customer);
  return (
    <div className="shop-photo-block">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img className="shop-photo" src={url} alt={t('Shop front of {name}', { name: customer.name })} />
        </a>
      ) : (
        <p className="shop-photo-empty muted">{t('No shop photo yet')}</p>
      )}
      {canEdit && (
        <>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            className="visually-hidden"
            aria-label={t('Shop photo — front')}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = '';
            }}
          />
          <button type="button" className="button button-small" disabled={upload.isPending} onClick={() => input.current?.click()}>
            <Icon name="camera" size={16} />
            {upload.isPending ? t('Sending photo…') : url ? t('Change photo') : t('Add shop photo')}
          </button>
        </>
      )}
      {upload.error && (
        <p className="field-note" data-tone="bad">
          {upload.error instanceof Error ? upload.error.message : String(upload.error)}
        </p>
      )}
    </div>
  );
}
