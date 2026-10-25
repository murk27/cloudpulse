/**
 * The core of CloudPulse: check every monitor, store the results, open or close incidents,
 * send alerts and log a summary.
 *
 * Called from two places (both routes live in backend/app.ts):
 *   - GET  /api/cron/check -> by GitHub Actions every 5 minutes (and Vercel Cron once a day)
 *   - POST /api/check-now  -> by the "Run check now" button on the dashboard
 */
import type { CheckResult, Monitor, RunSummary } from "../../shared/types.js";
import { formatDuration } from "../../shared/format.js";
import { sendAlert } from "./alerts.js";
import { limits } from "./config.js";
import {
  addToDailyRollup,
  getChecksSince,
  listMonitors,
  openIncident,
  resolveIncident,
  saveCheck,
  saveMonitorState,
  trimChecks,
} from "./db.js";
import { checkUrl } from "./http-check.js";
import { evaluateCheck } from "./incidents.js";
import { average, computeStats, utcDate } from "./stats.js";

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
  // One structured JSON line per run: easy to search and filter in Vercel's runtime logs.
  console.log(JSON.stringify({ event: "check_run", ...summary, avgLatencyMs: Math.round(average(latencies) ?? 0) }));
  return summary;
}

async function checkMonitor(monitor: Monitor): Promise<MonitorRunResult> {
  // 1. Do the HTTP check.
  const outcome = await checkUrl(monitor.url, monitor.expectedStatus, limits.checkTimeoutMs);
  const checkedAt = new Date().toISOString();
  const check: CheckResult = { monitorId: monitor.id, checkedAt, ...outcome };

  // 2. Store the raw check, bump today's counters, and drop checks older than 7 days (in parallel).
  const retentionCutoff = Date.parse(checkedAt) - limits.checkRetentionDays * 24 * 60 * 60 * 1000;
  await Promise.all([
    saveCheck(check),
    addToDailyRollup(monitor.id, utcDate(new Date(checkedAt)), outcome.ok),
    trimChecks(monitor.id, retentionCutoff),
  ]);

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
          `You'll get another alert when it recovers.`,
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
  const recent = await getChecksSince(monitor.id, since); // includes the check saved above

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

/** Sends an alert, but never lets a Discord problem break the check itself. */
async function notify(subject: string, message: string): Promise<void> {
  try {
    await sendAlert(subject, message);
  } catch (err) {
    console.error("Failed to send alert", err);
  }
}
