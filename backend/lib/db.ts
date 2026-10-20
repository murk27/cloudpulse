/**
 * All DynamoDB access lives in this file. CloudPulse uses ONE table ("single-table design").
 *
 * Item layout (PK = partition key, SK = sort key):
 *   Monitor   PK = "MONITOR"               SK = <monitorId>
 *   Check     PK = "CHECK#<monitorId>"     SK = <checkedAt, ISO timestamp>   (TTL: 90 days)
 *   Day       PK = "DAY#<monitorId>"       SK = <YYYY-MM-DD>                 (TTL: 100 days)
 *   Incident  PK = "INCIDENT#<monitorId>"  SK = <startedAt, ISO timestamp>
 *
 * ISO timestamps sort alphabetically in time order, so "all checks since X" is a single
 * cheap Query on one partition with `SK >= X`. No table scans are needed anywhere in the app.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { CheckResult, DayRollup, Incident, Monitor } from "../../shared/types.ts";
import { config, limits } from "./config.ts";

let docClient: DynamoDBDocumentClient | undefined;

/** Returns a DynamoDB client, created on first use and then reused across Lambda invocations. */
export function getDb(): DynamoDBDocumentClient {
  if (!docClient) {
    const endpoint = config.dynamoEndpoint();
    const client = new DynamoDBClient({
      region: config.region(),
      // Locally we talk to dynalite (an in-memory DynamoDB clone) with dummy credentials.
      ...(endpoint ? { endpoint, credentials: { accessKeyId: "local", secretAccessKey: "local" } } : {}),
    });
    // removeUndefinedValues lets us pass objects with optional fields straight to DynamoDB.
    docClient = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }
  return docClient;
}

/** Builds the primary key for each item type. */
export const keys = {
  monitor: (id: string) => ({ PK: "MONITOR", SK: id }),
  check: (monitorId: string, checkedAt: string) => ({ PK: `CHECK#${monitorId}`, SK: checkedAt }),
  day: (monitorId: string, date: string) => ({ PK: `DAY#${monitorId}`, SK: date }),
  incident: (monitorId: string, startedAt: string) => ({ PK: `INCIDENT#${monitorId}`, SK: startedAt }),
};

/** DynamoDB TTL wants "seconds since 1970". Items are deleted for free some time after this. */
export function expiresAfterDays(days: number, from: number = Date.now()): number {
  return Math.floor(from / 1000) + days * 24 * 60 * 60;
}

/** Removes the storage-only fields (PK, SK, expiresAt) before an item is returned to callers. */
function strip<T>(item: Record<string, unknown>): T {
  const { PK: _pk, SK: _sk, expiresAt: _exp, ...rest } = item;
  return rest as T;
}

/** Runs a Query and follows pagination until every matching item has been read. */
async function queryAll(input: Omit<QueryCommandInput, "TableName">): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await getDb().send(
      new QueryCommand({ ...input, TableName: config.tableName(), ExclusiveStartKey: startKey }),
    );
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
    if (input.Limit && items.length >= input.Limit) break;
  } while (startKey);
  return items;
}

/**
 * Turns { a: 1, b: undefined } into "SET #a = :a REMOVE #b".
 * Every attribute name goes through "#name" placeholders so we never clash with
 * DynamoDB reserved words (status, name, url... are all reserved).
 */
function buildUpdate(fields: Record<string, unknown>) {
  const set: string[] = [];
  const remove: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(fields)) {
    names[`#${field}`] = field;
    if (value === undefined) {
      remove.push(`#${field}`);
    } else {
      set.push(`#${field} = :${field}`);
      values[`:${field}`] = value;
    }
  }
  const expression = [set.length ? `SET ${set.join(", ")}` : "", remove.length ? `REMOVE ${remove.join(", ")}` : ""]
    .join(" ")
    .trim();
  return { expression, names, values };
}

function isConditionFailure(err: unknown): boolean {
  return err instanceof Error && err.name === "ConditionalCheckFailedException";
}

// ---------------------------------------------------------------- monitors

export async function listMonitors(): Promise<Monitor[]> {
  const items = await queryAll({
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": "MONITOR" },
  });
  return items.map((item) => strip<Monitor>(item)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getMonitor(id: string): Promise<Monitor | null> {
  const result = await getDb().send(new GetCommand({ TableName: config.tableName(), Key: keys.monitor(id) }));
  return result.Item ? strip<Monitor>(result.Item) : null;
}

export async function createMonitor(monitor: Monitor): Promise<void> {
  await getDb().send(
    new PutCommand({
      TableName: config.tableName(),
      Item: { ...keys.monitor(monitor.id), ...monitor },
      ConditionExpression: "attribute_not_exists(PK)", // never overwrite an existing monitor
    }),
  );
}

/** Deletes a monitor. Its old checks and rollups are cleaned up later by TTL, for free. */
export async function deleteMonitor(id: string): Promise<boolean> {
  const result = await getDb().send(
    new DeleteCommand({ TableName: config.tableName(), Key: keys.monitor(id), ReturnValues: "ALL_OLD" }),
  );
  return Boolean(result.Attributes);
}

/** The fields the checker updates on a monitor after each check. */
export type MonitorState = Pick<
  Monitor,
  "status" | "consecutiveFailures" | "failingSince" | "lastCheckedAt" | "lastLatencyMs" | "lastStatusCode" | "lastError" | "stats"
>;

/** Saves the latest state. Returns false if the monitor was deleted while it was being checked. */
export async function saveMonitorState(id: string, state: MonitorState): Promise<boolean> {
  const update = buildUpdate({ ...state });
  try {
    await getDb().send(
      new UpdateCommand({
        TableName: config.tableName(),
        Key: keys.monitor(id),
        UpdateExpression: update.expression,
        ExpressionAttributeNames: update.names,
        ExpressionAttributeValues: update.values,
        ConditionExpression: "attribute_exists(PK)", // don't re-create a deleted monitor
      }),
    );
    return true;
  } catch (err) {
    if (isConditionFailure(err)) return false;
    throw err;
  }
}

// ---------------------------------------------------------------- checks + daily rollups

export async function saveCheck(check: CheckResult): Promise<void> {
  await getDb().send(
    new PutCommand({
      TableName: config.tableName(),
      Item: {
        ...keys.check(check.monitorId, check.checkedAt),
        ...check,
        expiresAt: expiresAfterDays(limits.checkRetentionDays, Date.parse(check.checkedAt)),
      },
    }),
  );
}

/** Adds one check to that day's counters. ADD is atomic, so concurrent runs can't lose a count. */
export async function addToDailyRollup(monitorId: string, date: string, ok: boolean): Promise<void> {
  await getDb().send(
    new UpdateCommand({
      TableName: config.tableName(),
      Key: keys.day(monitorId, date),
      UpdateExpression: "ADD checksTotal :one, checksOk :ok SET #date = :date, expiresAt = :exp",
      ExpressionAttributeNames: { "#date": "date" },
      ExpressionAttributeValues: {
        ":one": 1,
        ":ok": ok ? 1 : 0,
        ":date": date,
        ":exp": expiresAfterDays(limits.rollupRetentionDays, Date.parse(`${date}T00:00:00Z`)),
      },
    }),
  );
}

/** Checks for one monitor since a timestamp. Oldest first unless newestFirst is set. */
export async function getChecksSince(
  monitorId: string,
  sinceIso: string,
  options: { newestFirst?: boolean; limit?: number } = {},
): Promise<CheckResult[]> {
  const items = await queryAll({
    KeyConditionExpression: "PK = :pk AND SK >= :since",
    ExpressionAttributeValues: { ":pk": `CHECK#${monitorId}`, ":since": sinceIso },
    ScanIndexForward: !options.newestFirst,
    Limit: options.limit,
  });
  return items.map((item) => strip<CheckResult>(item));
}

export async function getDailyRollups(monitorId: string, sinceDate: string): Promise<DayRollup[]> {
  const items = await queryAll({
    KeyConditionExpression: "PK = :pk AND SK >= :since",
    ExpressionAttributeValues: { ":pk": `DAY#${monitorId}`, ":since": sinceDate },
  });
  return items.map((item) => strip<DayRollup>(item));
}

// ---------------------------------------------------------------- incidents

export async function getIncidents(monitorId: string, limit = 20): Promise<Incident[]> {
  const items = await queryAll({
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": `INCIDENT#${monitorId}` },
    ScanIndexForward: false, // newest first
    Limit: limit,
  });
  return items.slice(0, limit).map((item) => strip<Incident>(item));
}

/**
 * Opens an incident. The conditional write ("only if no incident is open") makes this safe
 * even if two checker runs overlap: only one of them can win, so we never send duplicate alerts.
 * Returns false if another run already opened it.
 */
export async function openIncident(monitor: Monitor, startedAt: string, cause: string): Promise<boolean> {
  try {
    await getDb().send(
      new UpdateCommand({
        TableName: config.tableName(),
        Key: keys.monitor(monitor.id),
        UpdateExpression: "SET openIncidentStartedAt = :startedAt",
        ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(openIncidentStartedAt)",
        ExpressionAttributeValues: { ":startedAt": startedAt },
      }),
    );
  } catch (err) {
    if (isConditionFailure(err)) return false;
    throw err;
  }
  const incident: Incident = { monitorId: monitor.id, monitorName: monitor.name, startedAt, cause };
  await getDb().send(
    new PutCommand({ TableName: config.tableName(), Item: { ...keys.incident(monitor.id, startedAt), ...incident } }),
  );
  return true;
}

/** Closes the open incident (same conditional-write trick). Returns the closed incident, or null. */
export async function resolveIncident(monitor: Monitor, resolvedAt: string): Promise<Incident | null> {
  const startedAt = monitor.openIncidentStartedAt;
  if (!startedAt) return null;
  try {
    await getDb().send(
      new UpdateCommand({
        TableName: config.tableName(),
        Key: keys.monitor(monitor.id),
        UpdateExpression: "REMOVE openIncidentStartedAt",
        ConditionExpression: "openIncidentStartedAt = :startedAt",
        ExpressionAttributeValues: { ":startedAt": startedAt },
      }),
    );
  } catch (err) {
    if (isConditionFailure(err)) return null;
    throw err;
  }
  const result = await getDb().send(
    new UpdateCommand({
      TableName: config.tableName(),
      Key: keys.incident(monitor.id, startedAt),
      UpdateExpression: "SET resolvedAt = :resolvedAt",
      ExpressionAttributeValues: { ":resolvedAt": resolvedAt },
      ReturnValues: "ALL_NEW",
    }),
  );
  return result.Attributes ? strip<Incident>(result.Attributes) : null;
}
