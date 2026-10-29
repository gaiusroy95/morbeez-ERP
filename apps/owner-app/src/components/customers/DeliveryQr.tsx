'use client';

import { useMemo } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import type { CustomerRecord } from '@morbeez/shared-types';
import { FormDialog } from '@/components/ui/Form';
import { apiSend } from '@/lib/api/client';
import { useAction } from '@/lib/hooks/use-action';
import { useT } from '@/lib/i18n';

/** What the printed QR carries; the driver app checks it against the stop's customer (driver app D3). */
export const QR_PREFIX = 'MORBEEZ:C:';

/** The customer's delivery QR, as an SVG that scales to its box. */
export function qrSvg(token: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(`${QR_PREFIX}${token}`);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/**
 * The shop's delivery QR (client spec §12; the client's answer 5): print it
 * and put it up at the shop; the driver scans it at every delivery. A new
 * one makes the old printout stop matching — for a lost or copied QR.
 */
export function DeliveryQrDialog({
  customer,
  canWrite,
  invalidates,
  onClose,
}: {
  customer: CustomerRecord;
  canWrite: boolean;
  invalidates: QueryKey[];
  onClose: () => void;
}) {
  const t = useT();
  const svg = useMemo(() => qrSvg(customer.qrToken), [customer.qrToken]);
  const renew = useAction(() => apiSend<CustomerRecord>('POST', `customers/${customer.id}/qr`), invalidates);

  const print = () => {
    const w = window.open('', '_blank', 'width=480,height=680');
    if (!w) return;
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(customer.name)}</title>` +
        '<style>body{font-family:system-ui,sans-serif;text-align:center;padding:32px}svg{width:300px;height:300px}h1{font-size:28px;margin:0 0 16px}p{color:#444}</style>' +
        `</head><body><h1>${escapeHtml(customer.name)}</h1>${svg}<p>${escapeHtml(t('Scan at every delivery'))}</p><p>${customer.qrToken}</p></body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <FormDialog
      title={t('Delivery QR — {name}', { name: customer.name })}
      description={<p>{t('Print it and put it up at the shop: the driver scans it at every delivery.')}</p>}
      submitLabel="Print"
      pending={renew.isPending}
      error={renew.error}
      onClose={onClose}
      onSubmit={print}
    >
      <div className="delivery-qr" role="img" aria-label={t('Delivery QR')} dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="muted delivery-qr-code">{customer.qrToken}</p>
      {canWrite && (
        <div className="delivery-qr-renew">
          <button type="button" className="button" disabled={renew.isPending} onClick={() => renew.mutate(undefined)}>
            {t('Make a new QR')}
          </button>
          <p className="muted">{t('Lost or copied? A new QR stops the old printout working.')}</p>
        </div>
      )}
    </FormDialog>
  );
}
