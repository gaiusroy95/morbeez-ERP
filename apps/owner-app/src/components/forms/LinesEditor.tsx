'use client';

import { useEffect } from 'react';
import type { ProductRecord } from '@morbeez/shared-types';
import { formatMoney, formatQuantity } from '@/lib/format';
import { firstError, parseMoney, parseQuantity, type Parsed } from '@/lib/parse';
import { useT } from '@/lib/i18n';
import { SearchSelect } from './SearchSelect';

export interface LineDraft {
  key: number;
  productId: string;
  quantity: string;
  price: string;
  /** Eggs: trays ('pack') or single eggs ('base'). By-weight produce: kg ('base') or bags ('bag'). */
  unit?: 'base' | 'pack' | 'bag';
  /** Bought by the bag: kg in one bag. */
  kgPerBag?: string;
  /** The price was filled in from a suggestion, not typed. */
  suggested?: boolean;
}

/** Where a pre-filled price came from (client Q&A, pricing: the last actual price). */
export interface PriceHint {
  price: string | null;
  source: 'customer_last' | 'product_last' | 'reference' | null;
}

const SOURCE_LABEL: Record<NonNullable<PriceHint['source']>, string> = {
  customer_last: "this customer's last price",
  product_last: 'its last selling price',
  reference: 'reference price',
};

let nextKey = 1;
export const emptyLine = (): LineDraft => ({ key: nextKey++, productId: '', quantity: '', price: '' });

/** "piece" for one egg, "tray (30)" for a pack — what a quantity is counted in. */
const unitLabel = (p: ProductRecord | undefined, unit: LineDraft['unit']) =>
  !p ? 'Qty' : p.kind === 'egg' && unit === 'pack' ? `trays of ${p.packSize}` : p.baseUom;

/**
 * Product / quantity / price rows for a customer order or a purchase
 * order. With `hints` (a customer order), choosing a product fills in the
 * last actual price for that customer and product — a starting point the
 * owner can change; there is no permanent list price. `priceOptional`: a
 * blank price is sent as "not given" and the backend applies the same
 * suggestion, or refuses if there's none.
 */
export function LinesEditor({
  lines,
  onChange,
  products,
  currency,
  priceLabel,
  priceOptional,
  hints,
  onAddProduct,
  bags,
}: {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  products: ProductRecord[];
  currency: string;
  priceLabel: string;
  priceOptional: boolean;
  hints?: Map<string, PriceHint>;
  /** Offers "Create new product" in each line's list; the page opens QuickAddProduct beside its form. */
  onAddProduct?: (lineKey: number, typedName: string) => void;
  /** Offer "Bag" beside "kg" for produce bought by the bag (purchase orders). */
  bags?: boolean;
}) {
  const t = useT();
  const byId = new Map(products.map((p) => [p.id, p]));
  const update = (key: number, patch: Partial<LineDraft>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  // Suggestions arrive after the product is chosen (and change with the
  // customer): fill any price that's empty or was itself a suggestion.
  useEffect(() => {
    if (!hints) return;
    let changed = false;
    const next = lines.map((line) => {
      const hint = hints.get(line.productId);
      if (!hint?.price || (line.price !== '' && !line.suggested) || line.price === hint.price) return line;
      changed = true;
      return { ...line, price: hint.price, suggested: true };
    });
    if (changed) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hints]);

  // Display-only estimate; the backend computes the real total.
  const estimate = lines.reduce((sum, line) => {
    const p = byId.get(line.productId);
    const quantity = Number(line.quantity.replace(/,/g, '')) * perUnitOf(p, line);
    const price = Number((line.price.trim() || hints?.get(line.productId)?.price || '0').replace(/,/g, ''));
    return Number.isFinite(quantity * price) ? sum + quantity * price : sum;
  }, 0);

  return (
    <div className="lines-editor" role="group" aria-label={t('Lines')}>
      <div className="lines-editor-head" aria-hidden="true">
        <span>{t('Product')}</span>
        <span>{t('Quantity')}</span>
        <span>{priceLabel}</span>
        <span />
      </div>
      {lines.map((line, index) => {
        const product = byId.get(line.productId);
        const hint = hints?.get(line.productId);
        const n = index + 1;
        return (
          <div className="line-row" key={line.key}>
            <SearchSelect
              className="line-product"
              aria-label={`Line ${n} product`}
              value={line.productId}
              placeholder={t('Choose a product…')}
              searchPlaceholder={t('Search products…')}
              options={products.map((p) => ({ value: p.id, label: p.name, sub: p.category }))}
              createLabel={onAddProduct ? t('Create new product') : undefined}
              onCreate={onAddProduct ? (typed) => onAddProduct(line.key, typed) : undefined}
              onChange={(productId) => {
                const p = byId.get(productId);
                const h = hints?.get(productId);
                update(line.key, {
                  productId,
                  unit: p?.kind === 'egg' ? 'pack' : 'base',
                  ...(line.price === '' || line.suggested ? { price: h?.price ?? '', suggested: !!h?.price } : {}),
                });
              }}
            />
            <span className="line-qty">
              <input
                aria-label={`Line ${n} quantity in ${unitLabel(product, line.unit)}`}
                inputMode="decimal"
                placeholder={unitLabel(product, line.unit)}
                value={line.quantity}
                onChange={(event) => update(line.key, { quantity: event.target.value })}
              />
              {product?.kind === 'egg' && (
                <select
                  aria-label={`Line ${n} counted in`}
                  value={line.unit ?? 'pack'}
                  onChange={(event) => update(line.key, { unit: event.target.value as 'base' | 'pack' })}
                >
                  <option value="pack">{t('trays')}</option>
                  <option value="base">{t('eggs')}</option>
                </select>
              )}
              {bags && product && product.kind !== 'egg' && product.baseUom === 'kg' && (
                <select
                  aria-label={`Line ${n} counted in`}
                  value={line.unit === 'bag' ? 'bag' : 'base'}
                  onChange={(event) => update(line.key, { unit: event.target.value as 'base' | 'bag' })}
                >
                  <option value="base">kg</option>
                  <option value="bag">{t('Bag')}</option>
                </select>
              )}
            </span>
            {line.unit === 'bag' && (
              <span className="line-bag">
                <input
                  aria-label={`Line ${n} kg per bag`}
                  inputMode="decimal"
                  placeholder={t('kg / bag')}
                  value={line.kgPerBag ?? ''}
                  onChange={(event) => update(line.key, { kgPerBag: event.target.value })}
                />
                <span className="line-hint">
                  {t('kg / bag')}
                  {Number(line.quantity) > 0 && Number(line.kgPerBag) > 0
                    ? ` = ${formatQuantity(String(Number(line.quantity) * Number(line.kgPerBag)))} kg (${t('auto calculated')})`
                    : ''}
                </span>
              </span>
            )}
            <span className="line-price">
              <input
                aria-label={`Line ${n} ${priceLabel.toLowerCase()}${product ? ` per ${product.baseUom}` : ''}`}
                inputMode="decimal"
                placeholder={priceOptional ? 'Rate' : 'Rate'}
                value={line.price}
                onChange={(event) => update(line.key, { price: event.target.value, suggested: false })}
              />
              {product && (
                <span className="line-hint">
                  {t('per')} {product.baseUom}
                  {line.suggested && hint?.source ? ` · ${SOURCE_LABEL[hint.source]}` : ''}
                  {product.kind === 'egg' && line.price && Number(line.price) > 0
                    ? ` · ${formatMoney((Number(line.price) * (product.packSize ?? 30)).toFixed(2), currency)} a tray`
                    : ''}
                </span>
              )}
            </span>
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
          {t('Add a line')}
        </button>
        <span>
          {t('Estimated total')} <strong>{formatMoney(estimate.toFixed(2), currency)}</strong>
        </span>
      </div>
    </div>
  );
}

/** Puts a product just added (QuickAddProduct) on the line that asked for it. */
export function withProduct(lines: LineDraft[], lineKey: number, product: ProductRecord): LineDraft[] {
  return lines.map((line) =>
    line.key === lineKey ? { ...line, productId: product.id, unit: product.kind === 'egg' ? 'pack' : 'base' } : line,
  );
}

export interface ParsedLine {
  productId: string;
  /** In the product's base unit: eggs entered in trays are converted to pieces, bags to kg. */
  quantity: number;
  price: number | undefined;
  /** Bought by the bag: how many, and kg in each. */
  bags?: number;
  kgPerBag?: number;
}

/** What one counted unit is worth in the product's base unit. */
function perUnitOf(product: ProductRecord | undefined, line: LineDraft): number {
  if (product?.kind === 'egg' && (line.unit ?? 'pack') === 'pack') return product.packSize ?? 1;
  if (line.unit === 'bag') return Number((line.kgPerBag ?? '').replace(/,/g, '')) || 0;
  return 1;
}

/** Validates every line; the first problem is reported by line number. */
export function parseLines(lines: LineDraft[], priceOptional: boolean, products: ProductRecord[] = []): Parsed<ParsedLine[]> {
  const byId = new Map(products.map((p) => [p.id, p]));
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
    const product = byId.get(line.productId);
    const counted = (quantity as { value: number }).value;
    if (line.unit === 'bag') {
      const kg = parseQuantity(line.kgPerBag ?? '', `the kg per bag on line ${n}`);
      if (!kg.ok) return kg;
      parsed.push({
        productId: line.productId,
        quantity: Math.round(counted * kg.value * 1000) / 1000,
        price: (price as { value: number | undefined }).value,
        bags: counted,
        kgPerBag: kg.value,
      });
      continue;
    }
    parsed.push({
      productId: line.productId,
      quantity: counted * perUnitOf(product, line),
      price: (price as { value: number | undefined }).value,
    });
  }
  return { ok: true, value: parsed };
}
