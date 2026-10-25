/**
 * All data access lives in this file, on top of the key-value store in kv.ts (Upstash Redis).
 *
 * Redis keys (all prefixed "cp:"):
 *   cp:monitors            HASH   id -> monitor settings (JSON). Written only by the API.
 *   cp:state               HASH   id -> latest status + 24h stats (JSON). Written only by the checker.
 *   cp:open:<id>           STRING start time of the open incident (exists only while one is open)
 *   cp:checks:<id>         ZSET   one member per check (JSON), scored by time in ms
 *   cp:days:<id>           HASH   "<date>:total" / "<date>:ok" -> counters for the 90-day bars
 *   cp:incidents:<id>      HASH   startedAt -> incident (JSON)
 *
 * Settings and state live in different hashes so the API and the checker never overwrite each
 * other's writes. A sorted set scored by timestamp makes "all checks since X" a single command.
 */
import type { CheckResult, DayRollup, Incident, Monitor } from "../../shared/types.js";
import { getKV } from "./kv.js";

const keys = {
  monitors: "cp:monitors",
  state: "cp:state",
  open: (id: string) => `cp:open:${id}`,
  checks: (id: string) => `cp:checks:${id}`,
  days: (id: string) => `cp:days:${id}`,
  incidents: (id: string) => `cp:incidents:${id}`,
};

/** What a human configures for a monitor (written by the API). */
export type MonitorConfig = Pick<Monitor, "id" | "name" | "url" | "expectedStatus" | "createdAt">;

/** What the checker records after each run. */
export type MonitorState = Pick<
  Monitor,
  "status" | "consecutiveFailures" | "failingSince" | "lastCheckedAt" | "lastLatencyMs" | "lastStatusCode" | "lastError" | "stats"
>;

export const EMPTY_STATE: MonitorState = {
  status: "pending",
  consecutiveFailures: 0,
  stats: { uptime24h: null, avgLatencyMs: null, p95LatencyMs: null, sparkline: [] },
};

// ---------------------------------------------------------------- monitors

/** All monitors: settings + latest state + open incident, in 3 commands total. */
export async function listMonitors(): Promise<Monitor[]> {
  const kv = getKV();
  const [configs, states] = await Promise.all([kv.hgetall(keys.monitors), kv.hgetall(keys.state)]);
  const ids = Object.keys(configs);
  const openIncidents = await kv.mget(ids.map(keys.open));

  return ids
    .map((id, i) => {
      const settings = JSON.parse(configs[id]!) as MonitorConfig;
      const state = states[id] ? (JSON.parse(states[id]) as MonitorState) : EMPTY_STATE;
      return { ...settings, ...state, openIncidentStartedAt: openIncidents[i] ?? undefined };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getMonitor(id: string): Promise<Monitor | null> {
  return (await listMonitors()).find((m) => m.id === id) ?? null;
}

export async function createMonitor(monitor: MonitorConfig): Promise<void> {
  const kv = getKV();
  await Promise.all([
    kv.hset(keys.monitors, { [monitor.id]: JSON.stringify(monitor) }),
    kv.hset(keys.state, { [monitor.id]: JSON.stringify(EMPTY_STATE) }),
  ]);
}

/** Deletes a monitor and all of its history. Returns false if it didn't exist. */
export async function deleteMonitor(id: string): Promise<boolean> {
  const kv = getKV();
  const removed = await kv.hdel(keys.monitors, id);
  if (removed === 0) return false;
  await Promise.all([
    kv.hdel(keys.state, id),
    kv.del(keys.open(id), keys.checks(id), keys.days(id), keys.incidents(id)),
  ]);
  return true;
}

export async function saveMonitorState(id: string, state: MonitorState): Promise<void> {
  await getKV().hset(keys.state, { [id]: JSON.stringify(state) });
}

// ---------------------------------------------------------------- checks + daily rollups

export async function saveCheck(check: CheckResult): Promise<void> {
  await getKV().zadd(keys.checks(check.monitorId), [
    { score: Date.parse(check.checkedAt), member: JSON.stringify(check) },
  ]);
}

/** Deletes raw checks older than the cutoff. (Redis expiry works per key, not per member.) */
export async function trimChecks(monitorId: string, olderThanMs: number): Promise<void> {
  await getKV().zremrangeByScore(keys.checks(monitorId), 0, olderThanMs);
}

/** Adds one check to that day's counters. HINCRBY is atomic, so concurrent runs can't lose a count. */
export async function addToDailyRollup(monitorId: string, date: string, ok: boolean): Promise<void> {
  const kv = getKV();
  await Promise.all([
    kv.hincrby(keys.days(monitorId), `${date}:total`, 1),
    ok ? kv.hincrby(keys.days(monitorId), `${date}:ok`, 1) : Promise.resolve(0),
  ]);
}

/** Checks for one monitor since a timestamp. Oldest first unless newestFirst is set. */
export async function getChecksSince(
  monitorId: string,
  sinceIso: string,
  options: { newestFirst?: boolean; limit?: number } = {},
): Promise<CheckResult[]> {
  const members = await getKV().zrangeByScore(keys.checks(monitorId), Date.parse(sinceIso), Number.MAX_SAFE_INTEGER);
  const checks = members.map((m) => JSON.parse(m) as CheckResult);
  if (options.newestFirst) checks.reverse();
  return options.limit ? checks.slice(0, options.limit) : checks;
}

export async function getDailyRollups(monitorId: string, sinceDate: string): Promise<DayRollup[]> {
  const counters = await getKV().hgetall(keys.days(monitorId));
  const rollups = new Map<string, DayRollup>();
  for (const [field, value] of Object.entries(counters)) {
    const [date, kind] = field.split(":") as [string, string];
    if (date < sinceDate) continue;
    const r = rollups.get(date) ?? { date, checksTotal: 0, checksOk: 0 };
    if (kind === "total") r.checksTotal = Number(value);
    else r.checksOk = Number(value);
    rollups.set(date, r);
  }
  return [...rollups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- incidents

export async function getIncidents(monitorId: string, limit = 20): Promise<Incident[]> {
  const all = await getKV().hgetall(keys.incidents(monitorId));
  return Object.values(all)
    .map((json) => JSON.parse(json) as Incident)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt)) // newest first
    .slice(0, limit);
}

/**
 * Opens an incident. SET ... NX ("only if it doesn't exist") is atomic, so if two checker runs
 * overlap only one of them can open the incident, and we never send duplicate alerts.
 * Returns false if another run already opened it.
 */
export async function openIncident(monitor: Monitor, startedAt: string, cause: string): Promise<boolean> {
  const kv = getKV();
  const won = await kv.set(keys.open(monitor.id), startedAt, { nx: true });
  if (!won) return false;
  const incident: Incident = { monitorId: monitor.id, monitorName: monitor.name, startedAt, cause };
  await kv.hset(keys.incidents(monitor.id), { [startedAt]: JSON.stringify(incident) });
  return true;
}

/** Closes the open incident. GETDEL is atomic too: only one run gets the start time back. */
export async function resolveIncident(monitor: Monitor, resolvedAt: string): Promise<Incident | null> {
  const kv = getKV();
  const startedAt = await kv.getdel(keys.open(monitor.id));
  if (!startedAt) return null;
  const stored = await kv.hget(keys.incidents(monitor.id), startedAt);
  const incident: Incident = {
    ...(stored
      ? (JSON.parse(stored) as Incident)
      : { monitorId: monitor.id, monitorName: monitor.name, startedAt, cause: "unknown" }),
    resolvedAt,
  };
  await kv.hset(keys.incidents(monitor.id), { [startedAt]: JSON.stringify(incident) });
  return incident;
}

// ---------------------------------------------------------------- outage demo switch

/** The fake "demo target" website is down while this key exists. */
const DEMO_DOWN_KEY = "cp:demo-down";

export async function isDemoTargetDown(): Promise<boolean> {
  return (await getKV().get(DEMO_DOWN_KEY)) !== null;
}

export async function setDemoTargetDown(down: boolean): Promise<void> {
  const kv = getKV();
  if (down) await kv.set(DEMO_DOWN_KEY, new Date().toISOString());
  else await kv.del(DEMO_DOWN_KEY);
}

// ---------------------------------------------------------------- seeding helpers

/** Deletes every CloudPulse key (used by the seed script). */
export async function wipeAll(): Promise<void> {
  const kv = getKV();
  const [configs, states] = await Promise.all([kv.hgetall(keys.monitors), kv.hgetall(keys.state)]);
  const ids = [...new Set([...Object.keys(configs), ...Object.keys(states)])];
  await kv.del(
    keys.monitors,
    keys.state,
    ...ids.flatMap((id) => [keys.open(id), keys.checks(id), keys.days(id), keys.incidents(id)]),
  );
}

/** Bulk writes for the seed script: whole histories in a handful of commands. */
export const bulk = {
  async monitors(entries: { config: MonitorConfig; state: MonitorState }[]): Promise<void> {
    const kv = getKV();
    await kv.hset(keys.monitors, Object.fromEntries(entries.map((e) => [e.config.id, JSON.stringify(e.config)])));
    await kv.hset(keys.state, Object.fromEntries(entries.map((e) => [e.config.id, JSON.stringify(e.state)])));
  },
  async checks(monitorId: string, checks: CheckResult[]): Promise<void> {
    await getKV().zadd(
      keys.checks(monitorId),
      checks.map((c) => ({ score: Date.parse(c.checkedAt), member: JSON.stringify(c) })),
    );
  },
  async rollups(monitorId: string, rollups: DayRollup[]): Promise<void> {
    const fields: Record<string, string> = {};
    for (const r of rollups) {
      fields[`${r.date}:total`] = String(r.checksTotal);
      fields[`${r.date}:ok`] = String(r.checksOk);
    }
    await getKV().hset(keys.days(monitorId), fields);
  },
  async incident(incident: Incident): Promise<void> {
    await getKV().hset(keys.incidents(incident.monitorId), { [incident.startedAt]: JSON.stringify(incident) });
  },
};
