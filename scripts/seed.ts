/**
 * Fills the database with realistic demo data so every chart looks good immediately:
 *   - 4 monitors pointing at well-known public websites
 *   - 48 hours of checks (one every 10 minutes) with realistic latency jitter
 *   - 90 days of daily uptime rollups for the status page bars
 *   - one resolved incident about 20 hours ago, with matching failed checks
 *
 * Usage:   npm run seed        -> seeds the DynamoDB table of your deployed "cloudpulse" stack
 * Local dev (npm run dev) calls seedDatabase() itself, so you never need to run this locally.
 *
 * WARNING: it deletes all existing CloudPulse data in the table first.
 */
import { pathToFileURL } from "node:url";
import { BatchWriteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { CheckResult, DayRollup, Incident, Monitor } from "../shared/types.ts";
import { config, limits } from "../backend/lib/config.ts";
import { expiresAfterDays, getDb, keys } from "../backend/lib/db.ts";
import { computeStats, utcDate } from "../backend/lib/stats.ts";

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

type Item = Record<string, unknown>;

/** Writes items 25 at a time (the BatchWrite maximum), retrying anything DynamoDB throttles. */
async function batchWrite(requests: Item[], log: (msg: string) => void): Promise<void> {
  const table = config.tableName();
  for (let i = 0; i < requests.length; i += 25) {
    let pending = requests.slice(i, i + 25);
    for (let attempt = 0; pending.length > 0; attempt++) {
      const result = await getDb().send(new BatchWriteCommand({ RequestItems: { [table]: pending } }));
      pending = (result.UnprocessedItems?.[table] as Item[] | undefined) ?? [];
      // Provisioned capacity is deliberately small (free tier), so back off and retry.
      if (pending.length > 0) await new Promise((r) => setTimeout(r, Math.min(5000, 200 * 2 ** attempt)));
    }
    const done = Math.min(requests.length, i + 25);
    if (done % 250 === 0 || done === requests.length) log(`  wrote ${done}/${requests.length} items`);
  }
}

async function wipeTable(log: (msg: string) => void): Promise<void> {
  const deletes: Item[] = [];
  let startKey: Item | undefined;
  do {
    const page = await getDb().send(
      new ScanCommand({ TableName: config.tableName(), ProjectionExpression: "PK, SK", ExclusiveStartKey: startKey }),
    );
    for (const item of page.Items ?? []) deletes.push({ DeleteRequest: { Key: { PK: item.PK, SK: item.SK } } });
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  if (deletes.length) {
    log(`Deleting ${deletes.length} existing items...`);
    await batchWrite(deletes, log);
  }
}

export async function seedDatabase(log: (msg: string) => void = console.log): Promise<void> {
  await wipeTable(log);

  const now = Date.now();
  const lastCheck = Math.floor((now - 5 * MINUTE) / CHECK_EVERY) * CHECK_EVERY; // aligned, a few minutes ago
  const firstCheck = lastCheck - 48 * HOUR;
  // The fake incident: Wikipedia returns 503 for ~25 minutes, about 20 hours ago.
  const incidentStart = Math.floor((now - 20 * HOUR) / CHECK_EVERY) * CHECK_EVERY;
  const incidentEnd = incidentStart + 30 * MINUTE; // first successful check after the outage

  const puts: Item[] = [];
  const put = (item: Item) => puts.push({ PutRequest: { Item: item } });

  SAMPLE_MONITORS.forEach((sample, index) => {
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
    for (const check of checks) {
      put({
        ...keys.check(check.monitorId, check.checkedAt),
        ...check,
        expiresAt: expiresAfterDays(limits.checkRetentionDays, Date.parse(check.checkedAt)),
      });
    }

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
    for (const r of rollups.values()) {
      put({
        ...keys.day(sample.id, r.date),
        ...r,
        expiresAt: expiresAfterDays(limits.rollupRetentionDays, Date.parse(`${r.date}T00:00:00Z`)),
      });
    }

    const latest = checks[checks.length - 1]!;
    const monitor: Monitor = {
      id: sample.id,
      name: sample.name,
      url: sample.url,
      expectedStatus: 200,
      createdAt: new Date(firstCheck - 90 * DAY + index * 1000).toISOString(),
      status: "up",
      consecutiveFailures: 0,
      lastCheckedAt: latest.checkedAt,
      lastLatencyMs: latest.latencyMs,
      lastStatusCode: latest.statusCode,
      stats: computeStats(checks, new Date(lastCheck)),
    };
    put({ ...keys.monitor(monitor.id), ...monitor });

    if (sample.id === "wikipedia") {
      const incident: Incident = {
        monitorId: sample.id,
        monitorName: sample.name,
        startedAt: new Date(incidentStart).toISOString(),
        resolvedAt: new Date(incidentEnd).toISOString(),
        cause: "Expected HTTP 200, got 503",
      };
      put({ ...keys.incident(sample.id, incident.startedAt), ...incident });
    }
  });

  log(`Writing ${puts.length} demo items (4 monitors, 48h of checks, 90 days of rollups, 1 incident)...`);
  await batchWrite(puts, log);
  log("Seed complete.");
}

/** When run from the command line: find the deployed table through CloudFormation, then seed it. */
async function main(): Promise<void> {
  process.env.AWS_REGION ??= process.env.AWS_DEFAULT_REGION ?? "us-east-1";
  if (!process.env.TABLE_NAME) {
    const { CloudFormationClient, DescribeStacksCommand } = await import("@aws-sdk/client-cloudformation");
    const stackName = process.env.STACK_NAME ?? "cloudpulse";
    const cfn = new CloudFormationClient({ region: process.env.AWS_REGION });
    const { Stacks } = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
    const tableName = Stacks?.[0]?.Outputs?.find((o) => o.OutputKey === "TableName")?.OutputValue;
    if (!tableName) throw new Error(`Stack "${stackName}" has no TableName output. Did you deploy it?`);
    process.env.TABLE_NAME = tableName;
  }
  console.log(`Seeding table ${process.env.TABLE_NAME} in ${process.env.AWS_REGION} (existing data will be replaced)`);
  await seedDatabase();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    console.error('Tip: if this is a credentials error, run:  eval "$(aws configure export-credentials --format env)"  and retry.');
    process.exit(1);
  });
}
