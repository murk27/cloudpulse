/**
 * Small 24-hour latency trend for the dashboard table (one point per hour, oldest first).
 * Gaps mean that hour had no successful check.
 */
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";

export function Sparkline({ values }: { values: (number | null)[] }) {
  if (!values.some((v) => v !== null)) return <span className="text-xs text-muted">no data yet</span>;
  const data = values.map((latency, i) => ({ hoursAgo: values.length - 1 - i, latency }));

  return (
    <div className="h-8 w-32">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
            allowEscapeViewBox={{ x: true, y: true }}
            wrapperStyle={{ zIndex: 20 }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as { hoursAgo: number; latency: number | null } | undefined;
              if (!active || !row) return null;
              return (
                <div className="rounded-md border border-line bg-surface px-2 py-1 text-xs shadow">
                  <span className="text-ink-2">{row.hoursAgo === 0 ? "This hour" : `${row.hoursAgo} h ago`}: </span>
                  <span className="font-medium text-ink">{row.latency === null ? "—" : `${row.latency} ms`}</span>
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
            activeDot={{ r: 3, stroke: "var(--surface)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
