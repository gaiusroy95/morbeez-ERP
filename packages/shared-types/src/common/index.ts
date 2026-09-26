// Every list endpoint's envelope — mirrors
// apps/backend/src/common/persistence/pagination.ts. pageSize is capped at
// 100 server-side (Constitution IV.5).
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Timestamps cross the wire as ISO-8601 strings; plain dates as YYYY-MM-DD.
export type IsoDateTime = string;
export type IsoDate = string;
