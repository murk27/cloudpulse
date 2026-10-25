/**
 * Fills the database with realistic demo data so every chart looks good immediately:
 *   - 4 monitors pointing at well-known public websites
 *   - 48 hours of checks (one every 10 minutes) with realistic latency jitter
 *   - 90 days of daily uptime rollups for the status page bars
 *   - one resolved incident about 20 hours ago, with matching failed checks
 *
 * Usage:   npx vercel env pull .env.local   (downloads the Upstash credentials)
 *          npm run seed
 * Local dev (npm run dev) calls seedDatabase() itself, so you never need to run this locally.
 *
 * WARNING: it deletes all existing CloudPulse data first. It costs only ~20 Redis commands,
 * because each monitor's whole history is written with one command per data type.
 */
import { pathToFileURL } from "node:url";
import type { CheckResult, DayRollup, Incident } from "../shared/types.js";
import { config } from "../backend/lib/config.js";
import { bulk, wipeAll, type MonitorConfig, type MonitorState } from "../backend/lib/db.js";
import { computeStats, utcDate } from "../backend/lib/stats.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CHECK_EVERY = 10 * MINUTE;

const SAMPLE_MONITORS = [
  { id: "example", name: "Example.com", url: "https://example.com", baseLatency: 95 },
  { id: "github", name: "GitHub", url: "https://github.com", baseLatency: 180 },
  { id: "wikipedia", name: "Wikipedia", url: "https://www.wikipedia.org", baseLatency: 140 },
  { id: "cloudflare", name: "Cloudflare", url: "https://www.cloudflare.com", baseLatency: 70 },
];

/** Tiny deterministic random generator, so every seed produces the same demo data. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedDatabase(log: (msg: string) => void = console.log): Promise<void> {
  log("Deleting existing CloudPulse data...");
  await wipeAll();

  const now = Date.now();
  const lastCheck = Math.floor((now - 5 * MINUTE) / CHECK_EVERY) * CHECK_EVERY; // aligned, a few minutes ago
  const firstCheck = lastCheck - 48 * HOUR;
  // The fake incident: Wikipedia returns 503 for ~25 minutes, about 20 hours ago.
  const incidentStart = Math.floor((now - 20 * HOUR) / CHECK_EVERY) * CHECK_EVERY;
  const incidentEnd = incidentStart + 30 * MINUTE; // first successful check after the outage

  const monitors: { config: MonitorConfig; state: MonitorState }[] = [];

  for (const [index, sample] of SAMPLE_MONITORS.entries()) {
    const rand = random(index + 1);
    const checks: CheckResult[] = [];

    for (let t = firstCheck; t <= lastCheck; t += CHECK_EVERY) {
      const failing = sample.id === "wikipedia" && t >= incidentStart && t < incidentEnd;
      // Latency = base + a daily wave (busier during the day) + noise + rare spikes.
      const wave = 1 + 0.25 * Math.sin(((t % DAY) / DAY) * 2 * Math.PI);
      const spike = rand() < 0.03 ? 2 + rand() * 2 : 1;
      const latencyMs = Math.round(sample.baseLatency * wave * spike * (0.85 + rand() * 0.3));
      checks.push({
        monitorId: sample.id,
        checkedAt: new Date(t).toISOString(),
        ok: !failing,
        statusCode: failing ? 503 : 200,
        latencyMs: failing ? Math.round(latencyMs * 0.6) : latencyMs,
        ...(failing ? { error: "Expected HTTP 200, got 503" } : {}),
      });
    }
    await bulk.checks(sample.id, checks);

    // Daily rollups: real counts for days covered by the checks above, synthetic before that.
    const rollups = new Map<string, DayRollup>();
    for (const check of checks) {
      const date = check.checkedAt.slice(0, 10);
      const r = rollups.get(date) ?? { date, checksTotal: 0, checksOk: 0 };
      r.checksTotal++;
      if (check.ok) r.checksOk++;
      rollups.set(date, r);
    }
    for (let d = 1; d < 90; d++) {
      const date = utcDate(new Date(firstCheck - d * DAY));
      if (rollups.has(date)) continue;
      const roll = rand();
      // Mostly perfect days, some with a blip or two (still >= 99%), and a rare bad day.
      const failed = roll < 0.88 ? 0 : roll < 0.97 ? 1 + Math.floor(rand() * 2) : 4 + Math.floor(rand() * 13);
      rollups.set(date, { date, checksTotal: 288, checksOk: 288 - failed });
    }
    await bulk.rollups(sample.id, [...rollups.values()]);

    const latest = checks[checks.length - 1]!;
    monitors.push({
      config: {
        id: sample.id,
        name: sample.name,
        url: sample.url,
        expectedStatus: 200,
        createdAt: new Date(firstCheck - 90 * DAY + index * 1000).toISOString(),
      },
      state: {
        status: "up",
        consecutiveFailures: 0,
        lastCheckedAt: latest.checkedAt,
        lastLatencyMs: latest.latencyMs,
        lastStatusCode: latest.statusCode,
        stats: computeStats(checks, new Date(lastCheck)),
      },
    });

    if (sample.id === "wikipedia") {
      const incident: Incident = {
        monitorId: sample.id,
        monitorName: sample.name,
        startedAt: new Date(incidentStart).toISOString(),
        resolvedAt: new Date(incidentEnd).toISOString(),
        cause: "Expected HTTP 200, got 503",
      };
      await bulk.incident(incident);
    }
    log(`  ${sample.name}: ${checks.length} checks, ${rollups.size} days of history`);
  }

  await bulk.monitors(monitors);
  log("Seed complete.");
}

/** When run from the command line: seed the Upstash database from .env.local. */
async function main(): Promise<void> {
  if (!config.redisUrl() || !config.redisToken()) {
    console.error("No Upstash credentials found. Run `npx vercel env pull .env.local` first (see README).");
    process.exit(1);
  }
  console.log(`Seeding ${new URL(config.redisUrl()!).host} (existing data will be replaced)`);
  await seedDatabase();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
