/**
 * Public status page. Data comes from GET /api/status, which Vercel's CDN caches for 60 s.
 * The footer shows whether this load was a CDN cache HIT or MISS (from the x-vercel-cache header).
 */
import { useEffect } from "react";
import type { OverallStatus, StatusPageResponse } from "../../../shared/types.js";
import { formatUptime } from "../../../shared/format.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { UptimeBars, UptimeLegend } from "../components/UptimeBars.js";
import { useApi } from "../lib/api.js";
import { formatDateTime, timeAgo } from "../lib/time.js";

const OVERALL: Record<OverallStatus, { text: string; icon: string; color: string; stripe: string }> = {
  operational: { text: "All systems operational", icon: "●", color: "text-good", stripe: "bg-good" },
  degraded: { text: "Some systems are down", icon: "▲", color: "text-warning", stripe: "bg-warning" },
  outage: { text: "Major outage", icon: "▲", color: "text-critical", stripe: "bg-critical" },
  unknown: { text: "Waiting for the first checks", icon: "○", color: "text-muted", stripe: "bg-nodata" },
};

/** Reads Vercel's x-vercel-cache (HIT, MISS, STALE...) and Age response headers. */
function CdnIndicator({ response, durationMs }: { response?: Response; durationMs?: number }) {
  if (!response) return null;
  const cache = response.headers.get("x-vercel-cache")?.toUpperCase();
  const age = response.headers.get("age");
  const took = durationMs === undefined ? "" : ` · ${durationMs} ms`;

  if (!cache) {
    return <span>CDN: none (local development, no Vercel edge network){took}</span>;
  }
  const fromEdge = cache === "HIT" || cache === "STALE";
  return (
    <span>
      Vercel CDN cache:{" "}
      <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono font-semibold text-ink">{cache}</span>{" "}
      {fromEdge
        ? `served from the edge${age ? `, ${age}s old` : ""}`
        : "generated fresh by the Vercel Function from Upstash Redis"}
      {took}
    </span>
  );
}

export function StatusPage() {
  const { data, error, loading, response, durationMs, reload } = useApi<StatusPageResponse>("/api/status");

  // Refresh every 60 seconds while the page is open.
  useEffect(() => {
    const timer = setInterval(reload, 60_000);
    return () => clearInterval(timer);
  }, [reload]);

  if (loading) return <p className="text-ink-2">Loading status…</p>;
  if (error && !data) return <p className="text-ink">Could not load status: {error}</p>;
  if (!data) return null;

  const overall = OVERALL[data.overall];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">System status</h1>
        <p className="mt-1 text-sm text-ink-2">Checked every 5 minutes by a scheduled serverless function.</p>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-line bg-surface p-5">
        <div className={`absolute inset-y-0 left-0 w-1.5 ${overall.stripe}`} />
        <div className="flex items-center gap-3 text-lg font-semibold text-ink">
          <span aria-hidden className={overall.color}>
            {overall.icon}
          </span>
          {overall.text}
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-line bg-surface p-5">
        {data.monitors.length === 0 && <p className="text-sm text-ink-2">No monitors yet. Add some from the dashboard.</p>}
        {data.monitors.map((monitor) => (
          <div key={monitor.id} className="space-y-2 border-b border-line pb-4 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium text-ink">{monitor.name}</span>
              <StatusBadge status={monitor.status} />
              <span className="ml-auto text-sm text-ink-2">
                {formatUptime(monitor.uptime24h)} uptime (24h) · checked {timeAgo(monitor.lastCheckedAt)}
              </span>
            </div>
            <UptimeBars days={monitor.days} />
          </div>
        ))}
        {data.monitors.length > 0 && <UptimeLegend />}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        <CdnIndicator response={response} durationMs={durationMs} />
        <span>Generated {formatDateTime(data.generatedAt)}</span>
        <button type="button" onClick={reload} className="rounded-md border border-line px-2 py-1 text-ink-2 hover:text-ink">
          Refresh
        </button>
      </div>
    </div>
  );
}
