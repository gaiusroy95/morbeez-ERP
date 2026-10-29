/**
 * A DATE column as YYYY-MM-DD. node-postgres turns DATE into a Date at the
 * server's local midnight, which JSON then writes in UTC — a day early east
 * of Greenwich. The local parts are the stored date.
 */
export function dateOnly(value: string | Date | null): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}
