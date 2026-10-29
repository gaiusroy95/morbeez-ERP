import { PoolClient } from 'pg';

// Trips count per day: 'trip:2026-10-28'.
export type DocumentKind = 'purchase_order' | 'customer_order' | `trip:${string}`;

/**
 * The next running number for a business's document of this kind, taken
 * inside the caller's transaction (commerce.document_counter). The counter
 * row is locked by the update until the transaction ends, so two documents
 * created at once get different numbers; a rolled-back document's number
 * is simply never used.
 */
export async function nextDocumentNumber(client: PoolClient, tenantId: string, kind: DocumentKind): Promise<number> {
  const result = await client.query<{ last_number: number }>(
    `INSERT INTO commerce.document_counter (tenant_id, kind, last_number) VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, kind) DO UPDATE SET last_number = commerce.document_counter.last_number + 1
     RETURNING last_number`,
    [tenantId, kind],
  );
  return result.rows[0].last_number;
}

/** "P-00123": the number as the owner reads it. */
export function formatPurchaseOrderNumber(n: number): string {
  return `P-${String(n).padStart(5, '0')}`;
}

/** "D-00231": a delivery (customer) order's number as the owner reads it. */
export function formatOrderNumber(n: number): string {
  return `D-${String(n).padStart(5, '0')}`;
}

/**
 * The trip's number for its day (the planned date, YYYY-MM-DD):
 * "T-20261028-001", counting from 1 each day per business.
 */
export async function nextTripNumber(client: PoolClient, tenantId: string, day: string): Promise<string> {
  const n = await nextDocumentNumber(client, tenantId, `trip:${day}`);
  return `T-${day.replace(/-/g, '')}-${String(n).padStart(3, '0')}`;
}
