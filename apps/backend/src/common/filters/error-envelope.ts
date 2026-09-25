// The one shape every error response takes, everywhere in the API
// (Constitution IV.6). No stack trace, no SQL fragment, no internal id
// ever reaches this body — request_id is what support and logs correlate
// on instead.
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id: string;
    details?: Record<string, unknown>;
  };
}

export function buildErrorEnvelope(
  code: string,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      request_id: requestId,
      ...(details ? { details } : {}),
    },
  };
}
