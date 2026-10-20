/**
 * Admin dashboard: summary tiles, the monitors table, "Run check now", and the add-monitor form.
 * Stats come pre-computed from the checker (stored on each monitor), so this page is one cheap query.
 */
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { Monitor, RunSummary } from "../../../shared/types.ts";
import { formatLatency, formatUptime } from "../../../shared/format.ts";
import { Sparkline } from "../components/Sparkline.tsx";
import { StatTile } from "../components/StatTile.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { ApiError, request, useApi } from "../lib/api.ts";
import { formatDateTime, timeAgo } from "../lib/time.ts";

function mean(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

export function DashboardPage() {
  const { data, error, loading, reload } = useApi<{ monitors: Monitor[] }>("/api/monitors");
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  async function runNow() {
    setRunning(true);
    setRunMessage(null);
    try {
      const { data: run, durationMs } = await request<RunSummary>("/api/check-now", { method: "POST" });
      const parts = [`Checked ${run.checked} monitor(s) in ${(durationMs / 1000).toFixed(1)} s: ${run.up} up, ${run.down} down.`];
      if (run.incidentsOpened.length) parts.push(`Incident opened: ${run.incidentsOpened.join(", ")} (alert sent).`);
      if (run.incidentsResolved.length) parts.push(`Recovered: ${run.incidentsResolved.join(", ")} (alert sent).`);
      setRunMessage(parts.join(" "));
      reload();
    } catch (err) {
      setRunMessage(err instanceof Error ? err.message : "Check failed");
    } finally {
      setRunning(false);
    }
  }

  async function remove(monitor: Monitor) {
    if (!window.confirm(`Delete "${monitor.name}"? Its history expires automatically later.`)) return;
    try {
      await request(`/api/monitors/${monitor.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const monitors = data?.monitors ?? [];
  const up = monitors.filter((m) => m.status === "up").length;
  const openIncidents = monitors.filter((m) => m.openIncidentStartedAt).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-2">Stats cover the last 24 hours and refresh after every check run.</p>
        </div>
        <button
          type="button"
          onClick={runNow}
          disabled={running}
          className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-60"
        >
          {running ? "Checking…" : "Run check now"}
        </button>
      </div>

      {runMessage && (
        <div role="status" className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink">
          {runMessage}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Monitors up" value={loading ? "…" : `${up} / ${monitors.length}`} />
        <StatTile label="Average uptime (24h)" value={formatUptime(mean(monitors.map((m) => m.stats?.uptime24h)))} />
        <StatTile label="Average latency (24h)" value={formatLatency(mean(monitors.map((m) => m.stats?.avgLatencyMs)))} />
        <StatTile label="Open incidents" value={loading ? "…" : String(openIncidents)} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-line text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Monitor</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Uptime</th>
              <th className="px-4 py-3 text-right font-medium">Avg</th>
              <th className="px-4 py-3 text-right font-medium">p95</th>
              <th className="px-4 py-3 font-medium">Latency, last 24h</th>
              <th className="px-4 py-3 font-medium">Last check</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="tabular">
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-ink-2">
                  Loading…
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-ink">
                  {error}
                </td>
              </tr>
            )}
            {!loading && monitors.length === 0 && !error && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-ink-2">
                  No monitors yet. Add one below.
                </td>
              </tr>
            )}
            {monitors.map((m) => (
              <tr key={m.id} className="border-b border-line last:border-0">
                <td className="max-w-[220px] px-4 py-3">
                  <Link to={`/monitors/${m.id}`} className="font-medium text-ink hover:underline">
                    {m.name}
                  </Link>
                  <div className="truncate text-xs text-muted" title={m.url}>
                    {m.url}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={m.status} />
                </td>
                <td className="px-4 py-3 text-right text-ink">{formatUptime(m.stats?.uptime24h)}</td>
                <td className="px-4 py-3 text-right text-ink">{formatLatency(m.stats?.avgLatencyMs)}</td>
                <td className="px-4 py-3 text-right text-ink">{formatLatency(m.stats?.p95LatencyMs)}</td>
                <td className="px-4 py-2">
                  <Sparkline values={m.stats?.sparkline ?? []} />
                </td>
                <td className="px-4 py-3 text-ink-2" title={m.lastError ?? formatDateTime(m.lastCheckedAt)}>
                  {timeAgo(m.lastCheckedAt)}
                  {m.lastError && <div className="max-w-[180px] truncate text-xs text-muted">{m.lastError}</div>}
                </td>
                <td className="px-4 py-3 text-right">
                  <button type="button" onClick={() => remove(m)} className="text-xs text-ink-2 hover:text-ink hover:underline">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AddMonitorForm onAdded={reload} />
    </div>
  );
}

function AddMonitorForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("https://");
  const [expectedStatus, setExpectedStatus] = useState("200");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await request("/api/monitors", {
        method: "POST",
        body: JSON.stringify({ name, url, expectedStatus: Number(expectedStatus) }),
      });
      setName("");
      setUrl("https://");
      setExpectedStatus("200");
      setMessage(`Added "${name}". It will be checked on the next run (or click "Run check now").`);
      onAdded();
    } catch (err) {
      const details = err instanceof ApiError && err.details ? ` (${err.details.join("; ")})` : "";
      setMessage(`${err instanceof Error ? err.message : "Could not add monitor"}${details}`);
    } finally {
      setBusy(false);
    }
  }

  const input = "mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 text-ink outline-none focus:border-accent";
  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-line bg-surface p-5">
      <h2 className="font-semibold text-ink">Add a monitor</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_2fr_140px_auto] sm:items-end">
        <label className="block text-sm">
          <span className="text-ink-2">Name</span>
          <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="My website" className={input} />
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">URL</span>
          <input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} className={input} />
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">Expected status</span>
          <input
            required
            type="number"
            min={100}
            max={599}
            value={expectedStatus}
            onChange={(e) => setExpectedStatus(e.target.value)}
            className={input}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Adding…" : "Add monitor"}
        </button>
      </div>
      {message && <p className="mt-3 text-sm text-ink-2">{message}</p>}
    </form>
  );
}
