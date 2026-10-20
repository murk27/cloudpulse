/**
 * The current time as React state, refreshed every `intervalMs`.
 * Components must not call Date.now() while rendering (the result would change on every
 * re-render), so they read the time from here instead.
 */
import { useEffect, useState } from "react";

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
