/**
 * Admin dashboard: summary tiles, the monitors table, "Run check now", and the add-monitor form.
 * Stats come pre-computed from the checker (stored on each monitor), so this page is one cheap query.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { Monitor, RunSummary } from "../../../shared/types.js";
import { formatLatency, formatUptime } from "../../../shared/format.js";
import { Sparkline } from "../components/Sparkline.js";
import { StatTile } from "../components/StatTile.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { ApiError, request, useApi } from "../lib/api.js";
import { formatDateTime, timeAgo } from "../lib/time.js";

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

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <AddMonitorForm onAdded={reload} />
        <OutageSimulator monitors={monitors} onChange={reload} />
      </div>
    </div>
  );
}

/**
 * Outage simulator for live demos. /api/demo-target is a fake website inside CloudPulse that
 * returns HTTP 503 while it is switched "down". Monitor it, take it down, run checks twice:
 * an incident opens and an alert is sent. Bring it back and run checks: the incident closes.
 */
function OutageSimulator({ monitors, onChange }: { monitors: Monitor[]; onChange: () => void }) {
  const targetUrl = `${window.location.origin}/api/demo-target`;
  const watched = monitors.some((m) => m.url === targetUrl);
  const [down, setDown] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/demo-target", { cache: "no-store" })
      .then((response) => setDown(response.status === 503))
      .catch(() => setDown(null));
  }, []);

  async function addDemoMonitor() {
    try {
      await request("/api/monitors", { method: "POST", body: JSON.stringify({ name: "Demo target", url: targetUrl }) });
      setMessage("Demo monitor added.");
      onChange();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not add the demo monitor");
    }
  }

  async function switchTo(nextDown: boolean) {
    try {
      await request("/api/demo-target", { method: "POST", body: JSON.stringify({ down: nextDown }) });
      setDown(nextDown);
      setMessage(
        nextDown
          ? 'The demo site now returns HTTP 503. Click "Run check now" twice to open an incident.'
          : 'The demo site is back (HTTP 200). Click "Run check now" to close the incident.',
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not switch the demo site");
    }
  }

  const button = "rounded-lg border border-line px-3 py-1.5 text-sm text-ink hover:bg-surface-2 disabled:opacity-50";
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold text-ink">Outage simulator</h2>
        {down !== null && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-xs text-ink">
            <span aria-hidden className={down ? "text-critical" : "text-good"}>
              {down ? "▲" : "●"}
            </span>
            {down ? "Demo site down" : "Demo site up"}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-ink-2">A fake website you control, for showing an outage and recovery live.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {!watched && (
          <button type="button" className={button} onClick={addDemoMonitor}>
            Monitor it
          </button>
        )}
        <button type="button" className={button} disabled={down === true} onClick={() => switchTo(true)}>
          Take it down
        </button>
        <button type="button" className={button} disabled={down === false} onClick={() => switchTo(false)}>
          Bring it back
        </button>
      </div>
      {message && <p className="mt-3 text-sm text-ink-2">{message}</p>}
    </section>
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
