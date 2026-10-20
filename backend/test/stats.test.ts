import { describe, expect, it } from "vitest";
import type { CheckResult } from "../../shared/types.ts";
import { formatDuration } from "../../shared/format.ts";
import { overallStatus } from "../handlers/api.ts";
import { buildUptimeBars, computeStats, percentile } from "../lib/stats.ts";

const NOW = new Date("2026-01-02T12:00:00.000Z");

function check(minutesAgo: number, ok: boolean, latencyMs: number): CheckResult {
  return {
    monitorId: "m1",
    checkedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    ok,
    statusCode: ok ? 200 : 500,
    latencyMs,
  };
}

describe("percentile", () => {
  it("returns null for no data", () => {
    expect(percentile([], 95)).toBeNull();
  });

  it("uses the nearest-rank method", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile([7], 95)).toBe(7);
  });
});

describe("computeStats", () => {
  it("computes uptime from all checks but latency only from successful ones", () => {
    const stats = computeStats([check(10, true, 100), check(20, true, 300), check(30, false, 10_000)], NOW);
    expect(stats.uptime24h).toBe(66.67);
    expect(stats.avgLatencyMs).toBe(200);
    expect(stats.p95LatencyMs).toBe(300);
  });

  it("ignores checks older than 24 hours", () => {
    const stats = computeStats([check(10, true, 100), check(25 * 60, false, 0)], NOW);
    expect(stats.uptime24h).toBe(100);
  });

  it("returns empty stats when there are no checks", () => {
    const stats = computeStats([], NOW);
    expect(stats).toMatchObject({ uptime24h: null, avgLatencyMs: null, p95LatencyMs: null });
    expect(stats.sparkline).toHaveLength(24);
  });

  it("puts the most recent hour in the last sparkline bucket", () => {
    const stats = computeStats([check(5, true, 120)], NOW);
    expect(stats.sparkline[23]).toBe(120);
    expect(stats.sparkline[0]).toBeNull();
  });
});

describe("buildUptimeBars", () => {
  it("returns 90 days, oldest first, with null for missing days", () => {
    const bars = buildUptimeBars([{ date: "2026-01-02", checksTotal: 4, checksOk: 3 }], NOW);
    expect(bars).toHaveLength(90);
    expect(bars.at(-1)).toEqual({ date: "2026-01-02", uptime: 75 });
    expect(bars.at(-2)?.uptime).toBeNull();
  });
});

describe("overallStatus", () => {
  it("summarises monitor states", () => {
    expect(overallStatus([])).toBe("unknown");
    expect(overallStatus([{ status: "pending" }])).toBe("unknown");
    expect(overallStatus([{ status: "up" }, { status: "up" }])).toBe("operational");
    expect(overallStatus([{ status: "up" }, { status: "down" }])).toBe("degraded");
    expect(overallStatus([{ status: "down" }, { status: "pending" }])).toBe("outage");
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(12_000)).toBe("12s");
    expect(formatDuration(250_000)).toBe("4m 10s");
    expect(formatDuration(2 * 3_600_000 + 5 * 60_000)).toBe("2h 5m");
  });
});
