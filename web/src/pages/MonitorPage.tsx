/** Monitor detail: 24h latency chart, incident timeline and the most recent checks. */
import { Link, useParams } from "react-router";
import type { Incident, MonitorDetailResponse } from "../../../shared/types.ts";
import { formatDuration, formatLatency, formatUptime } from "../../../shared/format.ts";
import { LatencyChart } from "../components/LatencyChart.tsx";
import { StatTile } from "../components/StatTile.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { useApi } from "../lib/api.ts";
import { formatDateTime, timeAgo } from "../lib/time.ts";
import { useNow } from "../lib/useNow.ts";

function IncidentRow({ incident, now }: { incident: Incident; now: number }) {
  const open = !incident.resolvedAt;
  const end = incident.resolvedAt ? Date.parse(incident.resolvedAt) : now;
  const duration = formatDuration(end - Date.parse(incident.startedAt));
  return (
    <li className="relative pl-6">
      <span aria-hidden className={`absolute left-0 top-0.5 text-xs ${open ? "text-critical" : "text-good"}`}>
        {open ? "▲" : "●"}
      </span>
      <div className="text-sm font-medium text-ink">
        {open ? "Ongoing outage" : "Resolved outage"} · {duration}
      </div>
      <div className="text-xs text-ink-2">
        {formatDateTime(incident.startedAt)} → {open ? "now" : formatDateTime(incident.resolvedAt)}
      </div>
      <div className="text-xs text-muted">Cause: {incident.cause}</div>
    </li>
  );
}

export function MonitorPage() {
  const { id = "" } = useParams();
  const { data, error, loading } = useApi<MonitorDetailResponse>(`/api/monitors/${encodeURIComponent(id)}`);
  const now = useNow();

  if (loading) return <p className="text-ink-2">Loading…</p>;
  if (error || !data) return <p className="text-ink">Could not load monitor: {error}</p>;

  const { monitor, checks, incidents } = data;
  return (
    <div className="space-y-6">
      <div>
        <Link to="/dashboard" className="text-sm text-ink-2 hover:text-ink">
          ← Dashboard
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-ink">{monitor.name}</h1>
          <StatusBadge status={monitor.status} />
        </div>
        <a href={monitor.url} target="_blank" rel="noreferrer" className="text-sm text-ink-2 hover:underline">
          {monitor.url}
        </a>
        <span className="text-sm text-muted"> · expects HTTP {monitor.expectedStatus}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Uptime (24h)" value={formatUptime(monitor.stats?.uptime24h)} />
        <StatTile label="Average latency" value={formatLatency(monitor.stats?.avgLatencyMs)} />
        <StatTile label="p95 latency" value={formatLatency(monitor.stats?.p95LatencyMs)} hint="95% of checks were faster" />
        <StatTile label="Last check" value={timeAgo(monitor.lastCheckedAt, now)} hint={monitor.lastError} />
      </div>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold text-ink">Response time, last 24 hours</h2>
        <p className="mb-4 text-xs text-muted">Gaps in the line are failed checks. Hover for details.</p>
        <LatencyChart checks={checks} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="font-semibold text-ink">Incidents</h2>
          {incidents.length === 0 ? (
            <p className="mt-3 text-sm text-ink-2">No incidents recorded.</p>
          ) : (
            <ol className="mt-4 space-y-4">
              {incidents.map((incident) => (
                <IncidentRow key={incident.startedAt} incident={incident} now={now} />
              ))}
            </ol>
          )}
        </section>

        <section className="overflow-x-auto rounded-xl border border-line bg-surface">
          <h2 className="px-5 pt-5 font-semibold text-ink">Recent checks</h2>
          <table className="mt-3 w-full min-w-[480px] text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-5 py-2 font-medium">Time</th>
                <th className="px-5 py-2 font-medium">Result</th>
                <th className="px-5 py-2 text-right font-medium">HTTP</th>
                <th className="px-5 py-2 text-right font-medium">Latency</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {checks.slice(0, 50).map((check) => (
                <tr key={check.checkedAt} className="border-b border-line last:border-0">
                  <td className="px-5 py-2 text-ink-2">{formatDateTime(check.checkedAt)}</td>
                  <td className="px-5 py-2 text-ink">
                    <span aria-hidden className={check.ok ? "text-good" : "text-critical"}>
                      {check.ok ? "●" : "▲"}
                    </span>{" "}
                    {check.ok ? "OK" : check.error ?? "Failed"}
                  </td>
                  <td className="px-5 py-2 text-right text-ink">{check.statusCode ?? "—"}</td>
                  <td className="px-5 py-2 text-right text-ink">{check.latencyMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
