export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// No endpoint returns an unbounded collection (Constitution IV.5) — these
// are the enforced default and ceiling every list() repository method
// clamps to, regardless of what a caller asks for.
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function clampPageSize(requested?: number): number {
  if (!requested || requested < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(requested, MAX_PAGE_SIZE);
}
