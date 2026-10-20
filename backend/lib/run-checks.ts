/**
 * The core of CloudPulse: check every monitor, store the results, open or close incidents,
 * send alerts and publish metrics.
 *
 * Called from two places:
 *   - handlers/checker.ts -> by EventBridge Scheduler every 5 minutes
 *   - handlers/api.ts     -> by the "Run check now" button on the dashboard
 */
import type { CheckResult, Monitor, RunSummary } from "../../shared/types.ts";
import { formatDuration } from "../../shared/format.ts";
import { sendAlert } from "./alerts.ts";
import { limits } from "./config.ts";
import {
  addToDailyRollup,
  getChecksSince,
  listMonitors,
  openIncident,
  resolveIncident,
  saveCheck,
  saveMonitorState,
} from "./db.ts";
import { checkUrl } from "./http-check.ts";
import { evaluateCheck } from "./incidents.ts";
import { publishRunMetrics } from "./metrics.ts";
import { average, computeStats, utcDate } from "./stats.ts";

interface MonitorRunResult {
  ok: boolean;
  latencyMs: number;
  opened: boolean;
  resolved: boolean;
}

export async function runAllChecks(): Promise<RunSummary> {
  const started = Date.now();
  const monitors = await listMonitors();

  // Check every monitor in parallel. allSettled (not all) means one broken monitor
  // can't stop the others from being checked and saved.
  const results = await Promise.allSettled(monitors.map((monitor) => checkMonitor(monitor)));

  const summary: RunSummary = {
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    checked: 0,
    up: 0,
    down: 0,
    incidentsOpened: [],
    incidentsResolved: [],
    errors: [],
  };
  const latencies: number[] = [];

  results.forEach((result, i) => {
    const name = monitors[i]?.name ?? "unknown";
    if (result.status === "rejected") {
      console.error(`Check failed to record for ${name}`, result.reason);
      summary.errors.push(`${name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      return;
    }
    summary.checked++;
    if (result.value.ok) {
      summary.up++;
      latencies.push(result.value.latencyMs);
    } else {
      summary.down++;
    }
    if (result.value.opened) summary.incidentsOpened.push(name);
    if (result.value.resolved) summary.incidentsResolved.push(name);
  });

  summary.durationMs = Date.now() - started;
  if (monitors.length > 0) {
    publishRunMetrics({
      MonitorsUp: summary.up,
      MonitorsDown: summary.down,
      AvgLatencyMs: Math.round(average(latencies) ?? 0),
    });
  }
  return summary;
}

async function checkMonitor(monitor: Monitor): Promise<MonitorRunResult> {
  // 1. Do the HTTP check.
  const outcome = await checkUrl(monitor.url, monitor.expectedStatus, limits.checkTimeoutMs);
  const checkedAt = new Date().toISOString();
  const check: CheckResult = { monitorId: monitor.id, checkedAt, ...outcome };

  // 2. Store the raw check and bump today's counters (in parallel).
  await Promise.all([saveCheck(check), addToDailyRollup(monitor.id, utcDate(new Date(checkedAt)), outcome.ok)]);

  // 3. Decide whether an incident opens or closes (pure logic, see incidents.ts).
  const evaluation = evaluateCheck(
    {
      consecutiveFailures: monitor.consecutiveFailures ?? 0,
      failingSince: monitor.failingSince,
      incidentOpen: Boolean(monitor.openIncidentStartedAt),
    },
    outcome.ok,
    checkedAt,
  );

  let opened = false;
  let resolved = false;
  if (evaluation.action === "open") {
    const startedAt = evaluation.failingSince ?? checkedAt;
    opened = await openIncident(monitor, startedAt, outcome.error ?? "Check failed");
    if (opened) {
      await notify(
        `[CloudPulse] DOWN: ${monitor.name}`,
        [
          `${monitor.name} is DOWN.`,
          ``,
          `URL:     ${monitor.url}`,
          `Reason:  ${outcome.error ?? "Check failed"}`,
          `Failing since: ${startedAt} (UTC)`,
          ``,
          `You'll get another email when it recovers.`,
        ].join("\n"),
      );
    }
  } else if (evaluation.action === "resolve") {
    const incident = await resolveIncident(monitor, checkedAt);
    resolved = incident !== null;
    if (incident) {
      const downtime = formatDuration(Date.parse(checkedAt) - Date.parse(incident.startedAt));
      await notify(
        `[CloudPulse] RECOVERED: ${monitor.name} (down ${downtime})`,
        [
          `${monitor.name} is back UP.`,
          ``,
          `URL:       ${monitor.url}`,
          `Downtime:  ${downtime}`,
          `Started:   ${incident.startedAt} (UTC)`,
          `Recovered: ${checkedAt} (UTC)`,
        ].join("\n"),
      );
    }
  }

  // 4. Recompute the 24h stats and save the monitor's new state.
  const since = new Date(Date.parse(checkedAt) - 24 * 60 * 60 * 1000).toISOString();
  const recent = await getChecksSince(monitor.id, since);
  // Queries are "eventually consistent", so the check we just wrote may not show up yet.
  if (!recent.some((c) => c.checkedAt === checkedAt)) recent.push(check);

  await saveMonitorState(monitor.id, {
    status: outcome.ok ? "up" : "down",
    consecutiveFailures: evaluation.consecutiveFailures,
    failingSince: evaluation.failingSince,
    lastCheckedAt: checkedAt,
    lastLatencyMs: outcome.latencyMs,
    lastStatusCode: outcome.statusCode,
    lastError: outcome.error,
    stats: computeStats(recent, new Date(checkedAt)),
  });

  return { ok: outcome.ok, latencyMs: outcome.latencyMs, opened, resolved };
}

/** Sends an alert, but never lets an SNS problem break the check itself. */
async function notify(subject: string, message: string): Promise<void> {
  try {
    await sendAlert(subject, message);
  } catch (err) {
    console.error("Failed to send alert", err);
  }
}
