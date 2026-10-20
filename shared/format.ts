/**
 * Small formatting helpers used by both the backend (alert emails) and the frontend.
 */

/** Turns a duration in milliseconds into "2h 5m", "4m 10s" or "12s". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

/** Formats an uptime percentage like "99.86%" (or an em dash when there is no data). */
export function formatUptime(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(value === 100 || value === 0 ? 0 : 2)}%`;
}

/** Formats a latency like "123 ms" (or an em dash when there is no data). */
export function formatLatency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value)} ms`;
}
