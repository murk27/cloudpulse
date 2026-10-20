/**
 * Latency over the last 24 hours for one monitor (monitor detail page).
 * Successful checks draw the line; failed checks leave a gap and are listed in the tooltip.
 */
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CheckResult } from "../../../shared/types.ts";
import { formatTime } from "../lib/time.ts";
import { useNow } from "../lib/useNow.ts";

interface Point {
  t: number;
  latency: number | null;
  check: CheckResult;
}

export function LatencyChart({ checks }: { checks: CheckResult[] }) {
  const now = useNow();
  // The API returns newest first; charts read left-to-right, oldest first.
  const data: Point[] = [...checks]
    .reverse()
    .map((check) => ({ t: Date.parse(check.checkedAt), latency: check.ok ? check.latencyMs : null, check }));

  if (data.length === 0) {
    return <div className="flex h-64 items-center justify-center text-sm text-muted">No checks in the last 24 hours yet.</div>;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
          <XAxis
            dataKey="t"
            type="number"
            domain={[now - 24 * 60 * 60 * 1000, now]}
            tickFormatter={formatTime}
            stroke="var(--axis)"
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            width={68}
            tickFormatter={(v: number) => `${v} ms`}
            stroke="var(--axis)"
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as Point | undefined;
              if (!active || !point) return null;
              const { check } = point;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
                  <div className="font-medium text-ink">{new Date(point.t).toLocaleString()}</div>
                  {check.ok ? (
                    <div className="text-ink-2">
                      {check.latencyMs} ms · HTTP {check.statusCode}
                    </div>
                  ) : (
                    <div className="text-ink-2">
                      <span className="text-critical">▲</span> Failed: {check.error ?? `HTTP ${check.statusCode}`}
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="latency"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
