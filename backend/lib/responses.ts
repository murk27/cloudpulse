/**
 * Helpers for building HTTP responses (standard Web `Response` objects, which is what
 * Vercel Functions return).
 */

/**
 * JSON response. By default responses must NOT be cached: they contain admin data.
 * Routes that may be cached by the CDN (only /api/status) pass their own Cache-Control.
 */
export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

export function error(status: number, message: string, details?: unknown, headers: Record<string, string> = {}): Response {
  return json(status, { error: message, ...(details ? { details } : {}) }, headers);
}
