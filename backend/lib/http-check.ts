/**
 * Performs ONE uptime check: an HTTP GET with a timeout, timed with a high-resolution clock.
 * A check "passes" when the response status equals the status code the monitor expects.
 */

export interface HttpCheckOutcome {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  error?: string;
}

export async function checkUrl(url: string, expectedStatus: number, timeoutMs: number): Promise<HttpCheckOutcome> {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      // Abort the request if the site hasn't answered within the timeout.
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "CloudPulse/1.0 (uptime monitor)" },
    });
    // Latency = time until the response headers arrived (like "time to first byte").
    const latencyMs = Math.round(performance.now() - started);
    // We don't need the body, so cancel the download to save time and memory.
    await response.body?.cancel();
    const ok = response.status === expectedStatus;
    return {
      ok,
      statusCode: response.status,
      latencyMs,
      error: ok ? undefined : `Expected HTTP ${expectedStatus}, got ${response.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      latencyMs: Math.round(performance.now() - started),
      error: describeFetchError(err, timeoutMs),
    };
  }
}

/** Turns low-level fetch errors into short, human-readable reasons. */
export function describeFetchError(err: unknown, timeoutMs: number): string {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return `Timed out after ${timeoutMs / 1000}s`;
  }
  // Node's fetch wraps network errors: the useful code (ENOTFOUND, ECONNREFUSED...) is in err.cause.
  const cause = err instanceof Error ? (err.cause as { code?: string } | undefined) : undefined;
  switch (cause?.code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "DNS lookup failed (domain not found)";
    case "ECONNREFUSED":
      return "Connection refused";
    case "ECONNRESET":
      return "Connection reset";
    case "CERT_HAS_EXPIRED":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
      return `TLS certificate error (${cause.code})`;
  }
  if (cause?.code) return `Network error (${cause.code})`;
  return err instanceof Error ? err.message : "Unknown error";
}
