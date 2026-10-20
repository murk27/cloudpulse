/**
 * Integration test: runs the REAL checker code against an in-memory DynamoDB (dynalite)
 * with a fake fetch(), and verifies the full incident lifecycle end to end.
 */
import type { Server } from "node:http";
import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import dynalite from "dynalite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Monitor } from "../../shared/types.ts";

const PORT = 4568;
let server: Server;

function newMonitor(id: string, name: string): Monitor {
  return {
    id,
    name,
    url: `https://${id}.test`,
    expectedStatus: 200,
    createdAt: new Date().toISOString(),
    status: "pending",
    consecutiveFailures: 0,
    stats: { uptime24h: null, avgLatencyMs: null, p95LatencyMs: null, sparkline: [] },
  };
}

/** Makes the fake network answer every request with this HTTP status. */
function networkReturns(status: number) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("body", { status })));
}

beforeAll(async () => {
  process.env.TABLE_NAME = "cloudpulse-test";
  process.env.DYNAMODB_ENDPOINT = `http://localhost:${PORT}`;
  process.env.AWS_REGION = "us-east-1";
  delete process.env.TOPIC_ARN; // alerts are logged instead of sent

  server = dynalite({ createTableMs: 0 });
  await new Promise<void>((resolve) => server.listen(PORT, () => resolve()));
  const client = new DynamoDBClient({
    endpoint: process.env.DYNAMODB_ENDPOINT,
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  await client.send(
    new CreateTableCommand({
      TableName: process.env.TABLE_NAME,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
    }),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
  server?.close();
});

describe("runAllChecks (integration)", () => {
  it("opens an incident after 2 failures, alerts once, and resolves it on recovery", async () => {
    const db = await import("../lib/db.ts");
    const { runAllChecks } = await import("../lib/run-checks.ts");
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

    await db.deleteMonitor("site");
    log.mockRestore();
  });

  it("never opens two incidents when two runs overlap (conditional write)", async () => {
    const db = await import("../lib/db.ts");
    const { runAllChecks } = await import("../lib/run-checks.ts");
    vi.spyOn(console, "log").mockImplementation(() => {});

    await db.createMonitor(newMonitor("race", "Race site"));
    networkReturns(503);
    await runAllChecks(); // 1st failure

    // Two runs at the same time both see "1 failure so far" and both want to open an incident.
    const [a, b] = await Promise.all([runAllChecks(), runAllChecks()]);
    expect(a.incidentsOpened.length + b.incidentsOpened.length).toBe(1);
    expect(await db.getIncidents("race")).toHaveLength(1);
  });
});
