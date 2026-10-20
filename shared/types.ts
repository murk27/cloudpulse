/**
 * Data shapes shared by the Lambda functions (backend/) and the React app (web/).
 * Keeping them in one file means the frontend and backend can never disagree about
 * what an API response looks like: TypeScript checks both sides against these types.
 */

export type MonitorStatus = "up" | "down" | "pending";

/** Stats for the last 24 hours. The checker recomputes them after every run. */
export interface MonitorStats {
  uptime24h: number | null; // percentage 0-100, null until the first check
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  /** 24 hourly average latencies, oldest first (null = no successful check that hour). */
  sparkline: (number | null)[];
}

/** A website we watch. Stored in DynamoDB as PK="MONITOR", SK=<id>. */
export interface Monitor {
  id: string;
  name: string;
  url: string;
  expectedStatus: number;
  createdAt: string; // ISO-8601 UTC timestamp
  status: MonitorStatus;
  consecutiveFailures: number;
  failingSince?: string; // first failure of the current failure streak
  openIncidentStartedAt?: string; // present only while an incident is open
  lastCheckedAt?: string;
  lastLatencyMs?: number;
  lastStatusCode?: number | null;
  lastError?: string;
  stats: MonitorStats;
}

/** One HTTP check. Stored as PK="CHECK#<monitorId>", SK=<checkedAt>. */
export interface CheckResult {
  monitorId: string;
  checkedAt: string;
  ok: boolean;
  statusCode: number | null; // null when there was no HTTP response (timeout, DNS error...)
  latencyMs: number;
  error?: string;
}

/** An outage: opened after 2 failed checks in a row, closed on the next success. */
export interface Incident {
  monitorId: string;
  monitorName: string;
  startedAt: string;
  resolvedAt?: string;
  cause: string;
}

/** Per-day counters used by the 90-day uptime bars. Stored as PK="DAY#<monitorId>", SK="YYYY-MM-DD". */
export interface DayRollup {
  date: string;
  checksTotal: number;
  checksOk: number;
}

// ---------- API response shapes ----------

export interface StatusPageDay {
  date: string;
  uptime: number | null; // null = no data for that day
}

export interface StatusPageMonitor {
  id: string;
  name: string;
  status: MonitorStatus;
  uptime24h: number | null;
  lastCheckedAt?: string;
  days: StatusPageDay[]; // exactly 90 entries, oldest first
}

export type OverallStatus = "operational" | "degraded" | "outage" | "unknown";

export interface StatusPageResponse {
  overall: OverallStatus;
  generatedAt: string;
  monitors: StatusPageMonitor[];
}

export interface MonitorDetailResponse {
  monitor: Monitor;
  checks: CheckResult[]; // last 24 hours, newest first
  incidents: Incident[]; // newest first
}

export interface RunSummary {
  startedAt: string;
  durationMs: number;
  checked: number;
  up: number;
  down: number;
  incidentsOpened: string[]; // monitor names
  incidentsResolved: string[];
  errors: string[]; // monitors whose check could not be recorded
}
