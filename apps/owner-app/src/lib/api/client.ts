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
  return readResponse<T>(response);
}

/**
 * A state-changing call. The body goes as JSON; `version` fields in it are
 * the optimistic-concurrency token the backend checks, so a 409 means
 * someone else changed the record first — reload it and try again.
 */
export async function apiSend<T>(method: 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/backend/${path}`, {
    method,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    cache: 'no-store',
  });
  return readResponse<T>(response);
}

async function readResponse<T>(response: Response): Promise<T> {
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
