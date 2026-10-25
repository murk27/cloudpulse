/**
 * Rate limiting: at most 10 requests per 10 seconds per IP address on public and write routes.
 *
 * Serverless functions don't share memory (many copies can run at once), so the counters must
 * live in a shared store: Upstash Redis, through the official @upstash/ratelimit library
 * ("sliding window" algorithm). Locally there's no Redis, so a simple in-memory version is used.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { limits } from "./config.js";
import { getUpstash } from "./kv.js";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

let upstashLimiter: Ratelimit | undefined;
const localHits = new Map<string, number[]>();

export async function checkRateLimit(ip: string): Promise<RateLimitResult> {
  const windowMs = limits.rateLimitWindowSeconds * 1000;
  const redis = getUpstash();

  if (redis) {
    upstashLimiter ??= new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limits.rateLimitRequests, `${limits.rateLimitWindowSeconds} s`),
      prefix: "cp:ratelimit",
      ephemeralCache: new Map(), // remembers blocked IPs in memory to save Redis commands
    });
    const { success, reset } = await upstashLimiter.limit(ip);
    return { allowed: success, retryAfterSeconds: Math.max(1, Math.ceil((reset - Date.now()) / 1000)) };
  }

  // Local fallback: keep the timestamps of each IP's recent requests.
  const now = Date.now();
  const recent = (localHits.get(ip) ?? []).filter((t) => t > now - windowMs);
  const allowed = recent.length < limits.rateLimitRequests;
  if (allowed) recent.push(now);
  localHits.set(ip, recent);
  const oldest = recent[0] ?? now;
  return { allowed, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
}

/** The caller's IP. Vercel puts it first in the X-Forwarded-For header. */
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
