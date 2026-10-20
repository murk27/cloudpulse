/**
 * The 90-day uptime strip on the status page: one thin bar per day, coloured by that day's
 * uptime, grey when there is no data. Hovering a bar shows the date and exact percentage.
 */
import { useState } from "react";
import type { StatusPageDay } from "../../../shared/types.ts";
import { formatUptime } from "../../../shared/format.ts";
import { formatDay } from "../lib/time.ts";

function barClass(uptime: number | null): string {
  if (uptime === null) return "bg-nodata";
  if (uptime >= 99) return "bg-good";
  if (uptime >= 95) return "bg-warning";
  return "bg-critical";
}

export function UptimeBars({ days }: { days: StatusPageDay[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const active = hovered === null ? null : days[hovered];

  return (
    <div className="relative">
      <div className="flex h-8 items-stretch gap-[2px]" onMouseLeave={() => setHovered(null)}>
        {days.map((day, i) => (
          <div
            key={day.date}
            className="flex flex-1 cursor-default items-stretch"
            onMouseEnter={() => setHovered(i)}
            aria-label={`${formatDay(day.date)}: ${day.uptime === null ? "no data" : formatUptime(day.uptime)}`}
          >
            <div className={`w-full rounded-[2px] ${barClass(day.uptime)} ${hovered === i ? "opacity-70" : ""}`} />
          </div>
        ))}
      </div>

      {active && hovered !== null && (
        <div
          className="pointer-events-none absolute -top-12 z-10 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
          style={{
            left: `${((hovered + 0.5) / days.length) * 100}%`,
            // Centre the tooltip on the bar, but keep it inside the card at both ends.
            transform: `translateX(${hovered < days.length * 0.1 ? "-10%" : hovered > days.length * 0.9 ? "-90%" : "-50%"})`,
          }}
        >
          <div className="font-medium text-ink">{formatDay(active.date)}</div>
          <div className="text-ink-2">{active.uptime === null ? "No data" : `${formatUptime(active.uptime)} uptime`}</div>
        </div>
      )}

      <div className="mt-1.5 flex justify-between text-xs text-muted">
        <span>90 days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}

/** Explains the bar colours (colour must never be the only way to read the chart). */
export function UptimeLegend() {
  const items = [
    { cls: "bg-good", label: "≥ 99%" },
    { cls: "bg-warning", label: "95–99%" },
    { cls: "bg-critical", label: "< 95%" },
    { cls: "bg-nodata", label: "No data" },
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-3 w-1.5 rounded-[2px] ${item.cls}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
