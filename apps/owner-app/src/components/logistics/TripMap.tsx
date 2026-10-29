'use client';

import type { TripStopRecord } from '@morbeez/shared-types';
import { usePins } from '@/lib/hooks/use-ai';
import { useT } from '@/lib/i18n';

type Point = { lat: number; lng: number };
type Placed = Point & { seq: number | null; name: string; status: TripStopRecord['status'] | 'depot' };

/** Straight-line distance in km (haversine) — the route on the road is longer. */
function km(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Where each stop is on the map, from the customers' and farmers' pins (and the depot's). */
export function useTripPoints(stops: TripStopRecord[]): { depot: Point | null; points: Placed[]; missing: number } {
  const pins = usePins();
  const find = (kind: string, id: string | null) => pins.data?.find((p) => p.kind === kind && p.refId === id && p.latitude && p.longitude);
  const depotPin = find('depot', null);
  const depot = depotPin ? { lat: Number(depotPin.latitude), lng: Number(depotPin.longitude) } : null;
  const points: Placed[] = [];
  let missing = 0;
  for (const s of stops) {
    const pin = s.party ? find(s.party.kind, s.party.id) : undefined;
    if (!pin) {
      missing++;
      continue;
    }
    points.push({ lat: Number(pin.latitude), lng: Number(pin.longitude), seq: s.sequenceNumber, name: s.party?.name ?? '', status: s.status });
  }
  return { depot, points, missing };
}

/** The trip's distance along its stops (from and back to the depot when pinned), in km. */
export function tripDistance(depot: Point | null, points: Point[]): number | null {
  const path = [...(depot ? [depot] : []), ...points, ...(depot ? [depot] : [])];
  if (path.length < 2) return null;
  let total = 0;
  for (let i = 1; i < path.length; i++) total += km(path[i - 1], path[i]);
  return total;
}

/** Google Maps directions through the stops, in order (opens in the browser or the Maps app). */
export function navigateUrl(depot: Point | null, points: Point[]): string | null {
  const path = [...(depot ? [depot] : []), ...points];
  if (path.length === 0) return null;
  const at = (p: Point) => `${p.lat},${p.lng}`;
  const origin = path[0];
  const destination = depot ?? path[path.length - 1];
  const waypoints = (depot ? points : path.slice(1, -1)).map(at).join('|');
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(at(origin))}&destination=${encodeURIComponent(at(destination))}${
    waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ''
  }&travelmode=driving`;
}

/**
 * The route drawn from the stops' map pins (no live tracking — the plan's
 * decision): the depot, each stop numbered in visiting order, done stops
 * filled. Straight lines between them, scaled to fit.
 */
export function TripMap({ stops }: { stops: TripStopRecord[] }) {
  const t = useT();
  const { depot, points, missing } = useTripPoints(stops);
  const all: Placed[] = [...(depot ? [{ ...depot, seq: null, name: t('Depot'), status: 'depot' as const }] : []), ...points];
  if (all.length === 0) {
    return <p className="muted map-empty">{t('Set map pins for these customers and farmers (AI → Route suggestions) to see the route drawn here.')}</p>;
  }
  const W = 320;
  const H = 170;
  const pad = 18;
  const meanLat = all.reduce((n, p) => n + p.lat, 0) / all.length;
  const xOf = (p: Point) => p.lng * Math.cos((meanLat * Math.PI) / 180);
  const xs = all.map(xOf);
  const ys = all.map((p) => p.lat);
  const spanX = Math.max(...xs) - Math.min(...xs) || 0.01;
  const spanY = Math.max(...ys) - Math.min(...ys) || 0.01;
  const scale = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
  const px = (p: Point) => pad + (xOf(p) - Math.min(...xs)) * scale + ((W - 2 * pad) - spanX * scale) / 2;
  const py = (p: Point) => H - pad - (p.lat - Math.min(...ys)) * scale - ((H - 2 * pad) - spanY * scale) / 2;
  const path = [...(depot ? [depot] : []), ...points, ...(depot ? [depot] : [])].map((p) => `${px(p).toFixed(1)},${py(p).toFixed(1)}`).join(' ');
  return (
    <figure className="trip-map">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Route map')}>
        <polyline points={path} className="trip-map-line" />
        {all.map((p, i) => (
          <g key={i} transform={`translate(${px(p).toFixed(1)} ${py(p).toFixed(1)})`} className="trip-map-pin" data-status={p.status}>
            <circle r={p.seq === null ? 7 : 9} />
            <text dy="3.5">{p.seq === null ? 'D' : p.seq}</text>
            <title>{p.name}</title>
          </g>
        ))}
      </svg>
      {missing > 0 && <figcaption className="muted">{t('{n} stop(s) have no map pin and are not drawn.', { n: missing })}</figcaption>}
    </figure>
  );
}
