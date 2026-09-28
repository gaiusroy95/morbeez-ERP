'use client';

import type { ProductRecord } from '@morbeez/shared-types';
import { formatMoney } from '@/lib/format';
import { firstError, parseMoney, parseQuantity, type Parsed } from '@/lib/parse';

export interface LineDraft {
  key: number;
  productId: string;
  quantity: string;
  price: string;
}

let nextKey = 1;
export const emptyLine = (): LineDraft => ({ key: nextKey++, productId: '', quantity: '', price: '' });

/**
 * Product / quantity / price rows for a customer order or a purchase
 * order. `priceOptional`: a blank price is sent as "not given", and the
 * backend prices the line at the product's base price — shown as the
 * placeholder, so the person sees what they'll get.
 */
export function LinesEditor({
  lines,
  onChange,
  products,
  currency,
  priceLabel,
  priceOptional,
}: {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  products: ProductRecord[];
  currency: string;
  priceLabel: string;
  priceOptional: boolean;
}) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const update = (key: number, patch: Partial<LineDraft>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  // Display-only estimate; the backend computes the real total.
  const estimate = lines.reduce((sum, line) => {
    const quantity = Number(line.quantity.replace(/,/g, ''));
    const price = line.price.trim()
      ? Number(line.price.replace(/,/g, ''))
      : priceOptional
        ? Number(byId.get(line.productId)?.basePrice ?? 0)
        : 0;
    return Number.isFinite(quantity * price) ? sum + quantity * price : sum;
  }, 0);

  return (
    <div className="lines-editor" role="group" aria-label="Lines">
      <div className="lines-editor-head" aria-hidden="true">
        <span>Product</span>
        <span>Quantity</span>
        <span>{priceLabel}</span>
        <span />
      </div>
      {lines.map((line, index) => {
        const product = byId.get(line.productId);
        const n = index + 1;
        return (
          <div className="line-row" key={line.key}>
            <select
              aria-label={`Line ${n} product`}
              value={line.productId}
              onChange={(event) => update(line.key, { productId: event.target.value })}
            >
              <option value="">Choose a product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              aria-label={`Line ${n} quantity${product ? ` in ${product.baseUom}` : ''}`}
              inputMode="decimal"
              placeholder={product ? product.baseUom : 'Qty'}
              value={line.quantity}
              onChange={(event) => update(line.key, { quantity: event.target.value })}
            />
            <input
              aria-label={`Line ${n} ${priceLabel.toLowerCase()}`}
              inputMode="decimal"
              placeholder={priceOptional && product ? `${product.basePrice} (list)` : 'Rate'}
              value={line.price}
              onChange={(event) => update(line.key, { price: event.target.value })}
            />
            <button
              type="button"
              className="button button-small"
              aria-label={`Remove line ${n}`}
              disabled={lines.length === 1}
              onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
            >
              ✕
            </button>
          </div>
        );
      })}
      <div className="lines-total">
        <button type="button" className="button button-small" onClick={() => onChange([...lines, emptyLine()])}>
          Add a line
        </button>
        <span>
          Estimated total <strong>{formatMoney(estimate.toFixed(2), currency)}</strong>
        </span>
      </div>
    </div>
  );
}

export interface ParsedLine {
  productId: string;
  quantity: number;
  price: number | undefined;
}

/** Validates every line; the first problem is reported by line number. */
export function parseLines(lines: LineDraft[], priceOptional: boolean): Parsed<ParsedLine[]> {
  const parsed: ParsedLine[] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const n = index + 1;
    if (!line.productId) return { ok: false, error: `Choose a product on line ${n}.` };
    if (seen.has(line.productId)) return { ok: false, error: `Line ${n} repeats a product — combine it with the earlier line.` };
    seen.add(line.productId);
    const quantity = parseQuantity(line.quantity, `the quantity on line ${n}`);
    const price =
      priceOptional && line.price.trim() === ''
        ? ({ ok: true, value: undefined } as const)
        : parseMoney(line.price, `the rate on line ${n}`);
    const error = firstError([quantity, price]);
    if (error) return { ok: false, error };
    parsed.push({
      productId: line.productId,
      quantity: (quantity as { value: number }).value,
      price: (price as { value: number | undefined }).value,
    });
  }
  return { ok: true, value: parsed };
}
