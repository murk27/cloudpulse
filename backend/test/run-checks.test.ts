/**
 * Integration test: runs the REAL checker code against the in-memory store (MemoryKV)
 * with a fake fetch(), and verifies the full incident lifecycle end to end.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "../lib/db.js";
import { MemoryKV, setKV } from "../lib/kv.js";
import { runAllChecks } from "../lib/run-checks.js";

function newMonitor(id: string, name: string): db.MonitorConfig {
  return { id, name, url: `https://${id}.test`, expectedStatus: 200, createdAt: new Date().toISOString() };
}

/**
 * Makes the fake network answer every request with this HTTP status, after 2 ms, so that
 * back-to-back runs get distinct timestamps (real runs are minutes apart).
 */
function networkReturns(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return new Response("body", { status });
    }),
  );
}

beforeEach(() => {
  setKV(new MemoryKV());
  delete process.env.DISCORD_WEBHOOK_URL; // alerts are logged instead of sent
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runAllChecks (integration)", () => {
  it("opens an incident after 2 failures, alerts once, and resolves it on recovery", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const alerts = () => log.mock.calls.map((c) => String(c[0])).filter((line) => line.startsWith("[alert]"));

    await db.createMonitor(newMonitor("site", "Test site"));

    networkReturns(200);
    await runAllChecks();
    expect((await db.getMonitor("site"))?.status).toBe("up");

    networkReturns(503);
    expect((await runAllChecks()).incidentsOpened).toEqual([]); // 1st failure: no alert yet
    expect((await runAllChecks()).incidentsOpened).toEqual(["Test site"]); // 2nd failure: incident
    expect((await runAllChecks()).incidentsOpened).toEqual([]); // still down: no duplicate

    const down = await db.getMonitor("site");
    expect(down?.status).toBe("down");
    expect(down?.consecutiveFailures).toBe(3);
    expect(down?.openIncidentStartedAt).toBe(down?.failingSince);

    networkReturns(200);
    expect((await runAllChecks()).incidentsResolved).toEqual(["Test site"]);

    const recovered = await db.getMonitor("site");
    expect(recovered?.status).toBe("up");
    expect(recovered?.openIncidentStartedAt).toBeUndefined();
    expect(recovered?.stats.uptime24h).toBe(40); // 2 of 5 checks passed

    const incidents = await db.getIncidents("site");
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.resolvedAt).toBeDefined();
    expect(incidents[0]?.cause).toBe("Expected HTTP 200, got 503");

    expect(alerts()).toHaveLength(2);
    expect(alerts()[0]).toContain("DOWN: Test site");
    expect(alerts()[1]).toContain("RECOVERED: Test site");

    const today = new Date().toISOString().slice(0, 10);
    const [rollup] = await db.getDailyRollups("site", today);
    expect(rollup).toEqual({ date: today, checksTotal: 5, checksOk: 2 });
    log.mockRestore();
  });

  it("never opens two incidents when two runs overlap (atomic SET NX)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await db.createMonitor(newMonitor("race", "Race site"));
    networkReturns(503);
    await runAllChecks(); // 1st failure

    // Two runs at the same time both see "1 failure so far" and both want to open an incident.
    const [a, b] = await Promise.all([runAllChecks(), runAllChecks()]);
    expect(a.incidentsOpened.length + b.incidentsOpened.length).toBe(1);
    expect(await db.getIncidents("race")).toHaveLength(1);
  });

  it("deletes a monitor together with its history", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await db.createMonitor(newMonitor("gone", "Gone site"));
    networkReturns(200);
    await runAllChecks();
    expect(await db.deleteMonitor("gone")).toBe(true);
    expect(await db.getMonitor("gone")).toBeNull();
    expect(await db.getChecksSince("gone", new Date(0).toISOString())).toEqual([]);
    expect(await db.deleteMonitor("gone")).toBe(false);
  });
});
