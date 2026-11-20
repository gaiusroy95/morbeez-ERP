import { PoolClient } from 'pg';

export type PinKind = 'customer' | 'farmer' | 'depot';

/**
 * A place's map pin (fulfilment.place_pin) — where a customer's shop, a
 * farm or the depot is — set in the caller's transaction. One pin per place:
 * moved if it exists, added if not. Read by route planning, the driver's
 * stop and the customer's profile. Logistics sets pins on the map; Customers
 * sets one when the owner takes a customer's location down.
 */
export async function upsertPlacePinWithClient(
  client: PoolClient,
  tenantId: string,
  userId: string,
  kind: PinKind,
  refId: string | null,
  latitude: number,
  longitude: number,
): Promise<void> {
  const updated = await client.query(
    `UPDATE fulfilment.place_pin SET latitude = $3, longitude = $4, updated_by = $5, updated_at = now()
     WHERE kind = $1 AND ref_id IS NOT DISTINCT FROM $2::uuid`,
    [kind, refId, latitude.toFixed(6), longitude.toFixed(6), userId],
  );
  if (!updated.rowCount) {
    await client.query(
      'INSERT INTO fulfilment.place_pin (tenant_id, kind, ref_id, latitude, longitude, updated_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [tenantId, kind, refId, latitude.toFixed(6), longitude.toFixed(6), userId],
    );
  }
}

/** Takes a place's pin away; true if there was one. */
export async function removePlacePinWithClient(client: PoolClient, kind: Exclude<PinKind, 'depot'>, refId: string): Promise<boolean> {
  const removed = await client.query('DELETE FROM fulfilment.place_pin WHERE kind = $1 AND ref_id = $2', [kind, refId]);
  return (removed.rowCount ?? 0) > 0;
}

/** A place's pin, if set. */
export async function placePinWithClient(
  client: PoolClient,
  kind: Exclude<PinKind, 'depot'>,
  refId: string,
): Promise<{ latitude: string; longitude: string } | null> {
  const r = await client.query<{ latitude: string; longitude: string }>(
    'SELECT latitude::text, longitude::text FROM fulfilment.place_pin WHERE kind = $1 AND ref_id = $2',
    [kind, refId],
  );
  return r.rows[0] ?? null;
}
