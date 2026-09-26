// Typed API client, contract-first against the backend's OpenAPI spec
// (Constitution IV.1). Always calls the same-origin proxy under
// /api/backend — the browser never talks to the backend or holds a token.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type QueryValue = string | number | undefined | null;

function toQueryString(params?: Record<string, QueryValue>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    // The backend's one error shape (Constitution IV.6): { error: { message } }.
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // fall through to a generic message
  }
  return `Request failed (${response.status})`;
}

export async function apiGet<T>(path: string, params?: Record<string, QueryValue>): Promise<T> {
  const response = await fetch(`/api/backend/${path}${toQueryString(params)}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });

  if (response.status === 401) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(`/login?next=${next}`);
    throw new ApiError(401, 'Your session has ended. Sign in again.');
  }
  if (!response.ok) throw new ApiError(response.status, await readErrorMessage(response));
  // A handler returning null (e.g. "no reconciliation yet") sends an empty 200.
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}
