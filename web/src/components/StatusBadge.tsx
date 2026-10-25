/**
 * Up / Down / Pending pill. Colour is never the only signal: each state also has its own
 * icon shape and a text label, so it reads correctly for colour-blind users and in print.
 */
import type { MonitorStatus } from "../../../shared/types.js";

const STYLES: Record<MonitorStatus, { label: string; icon: string; color: string }> = {
  up: { label: "Up", icon: "●", color: "text-good" },
  down: { label: "Down", icon: "▲", color: "text-critical" },
  pending: { label: "Pending", icon: "○", color: "text-muted" },
};

export function StatusBadge({ status }: { status: MonitorStatus }) {
  const style = STYLES[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-medium text-ink">
      <span aria-hidden className={`${style.color} text-[10px] leading-none`}>
        {style.icon}
      </span>
      {style.label}
    </span>
  );
}
