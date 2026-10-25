/**
 * Configuration, read from environment variables.
 *
 * On Vercel these are set in Project → Settings → Environment Variables (stored encrypted).
 * The Upstash Marketplace integration adds the Redis variables automatically.
 * Locally, scripts/local-server.ts sets safe defaults. Values are read lazily (inside
 * functions) so importing this file never crashes, even during the build.
 */

export const config = {
  /** Upstash Redis REST endpoint. The Vercel Marketplace may name it KV_REST_API_URL instead. */
  redisUrl: () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || undefined,
  redisToken: () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || undefined,
  /** Password for the admin dashboard. */
  adminPassword: () => process.env.ADMIN_PASSWORD || undefined,
  /** Shared secret that the scheduler sends as "Authorization: Bearer <CRON_SECRET>". */
  cronSecret: () => process.env.CRON_SECRET || undefined,
  /** Discord channel webhook for alerts. Optional: when missing, alerts are only logged. */
  discordWebhookUrl: () => process.env.DISCORD_WEBHOOK_URL || undefined,
  /** True when running on Vercel (set automatically by the platform). */
  onVercel: () => process.env.VERCEL === "1",
};

/**
 * Cost guardrails: keep usage far below the free limits.
 * Upstash's free tier allows 500,000 Redis commands per month. A check run costs about
 * 3 + 6 x (number of monitors) commands, so 6 monitors checked every 5 minutes is about
 * 39 x 8,640 runs = 337,000 commands per month, leaving room for the website itself.
 */
export const limits = {
  maxMonitors: 6,
  /** HTTP timeout for one check. */
  checkTimeoutMs: 10_000,
  /** Raw checks are kept this long (the status page uses daily rollups for older history). */
  checkRetentionDays: 7,
  /** Admin sessions expire after this long. */
  sessionTtlMs: 12 * 60 * 60 * 1000,
  /** Rate limit for public and write API routes: this many requests per window per IP. */
  rateLimitRequests: 10,
  rateLimitWindowSeconds: 10,
};
