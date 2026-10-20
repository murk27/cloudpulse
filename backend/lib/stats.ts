/**
 * Statistics math, as pure functions (easy to unit-test).
 * The checker calls computeStats() after every run and stores the result on the monitor,
 * so the dashboard reads ready-made numbers instead of re-reading 24h of checks each time.
 */
import type { CheckResult, DayRollup, MonitorStats, StatusPageDay } from "../../shared/types.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Nearest-rank percentile: p95 = the value 95% of samples are at or below. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? null;
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Rounds to 2 decimal places (for percentages). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Stats over the 24 hours before `now`.
 * Uptime counts every check; latency only counts successful checks (a 10s timeout
 * isn't a "latency", it's an outage, and would distort the average).
 */
export function computeStats(checks: CheckResult[], now: Date): MonitorStats {
  const windowStart = now.getTime() - DAY_MS;
  const recent = checks.filter((c) => Date.parse(c.checkedAt) > windowStart);
  const okLatencies = recent.filter((c) => c.ok).map((c) => c.latencyMs);

  // Sparkline: 24 one-hour buckets, oldest first, each holding that hour's average latency.
  const buckets: number[][] = Array.from({ length: 24 }, () => []);
  for (const check of recent) {
    if (!check.ok) continue;
    const index = Math.floor((Date.parse(check.checkedAt) - windowStart) / HOUR_MS);
    buckets[Math.min(23, Math.max(0, index))]?.push(check.latencyMs);
  }

  const avg = average(okLatencies);
  return {
    uptime24h: recent.length ? round2((recent.filter((c) => c.ok).length / recent.length) * 100) : null,
    avgLatencyMs: avg === null ? null : Math.round(avg),
    p95LatencyMs: percentile(okLatencies, 95),
    sparkline: buckets.map((bucket) => {
      const value = average(bucket);
      return value === null ? null : Math.round(value);
    }),
  };
}

/** "YYYY-MM-DD" in UTC. */
export function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Builds the 90 bars of the status page from daily rollups, filling missing days with null. */
export function buildUptimeBars(rollups: DayRollup[], today: Date, days = 90): StatusPageDay[] {
  const byDate = new Map(rollups.map((r) => [r.date, r]));
  const bars: StatusPageDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = utcDate(new Date(today.getTime() - i * DAY_MS));
    const rollup = byDate.get(date);
    bars.push({
      date,
      uptime: rollup && rollup.checksTotal > 0 ? round2((rollup.checksOk / rollup.checksTotal) * 100) : null,
    });
  }
  return bars;
}
