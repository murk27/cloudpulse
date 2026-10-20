/**
 * Incident rules, as a PURE function (no database, no network) so it is easy to unit-test.
 *
 *   - A failed check increases the failure streak.
 *   - When the streak reaches FAILURE_THRESHOLD (2) and no incident is open -> "open".
 *     Requiring 2 failures in a row avoids alerting on a single network blip.
 *   - A successful check while an incident is open -> "resolve".
 */

export const FAILURE_THRESHOLD = 2;

export interface MonitorHealth {
  consecutiveFailures: number;
  failingSince?: string; // timestamp of the first failure in the current streak
  incidentOpen: boolean;
}

export type IncidentAction = "open" | "resolve" | "none";

export interface Evaluation {
  consecutiveFailures: number;
  failingSince?: string;
  action: IncidentAction;
}

export function evaluateCheck(
  previous: MonitorHealth,
  ok: boolean,
  checkedAt: string,
  threshold: number = FAILURE_THRESHOLD,
): Evaluation {
  if (ok) {
    return {
      consecutiveFailures: 0,
      failingSince: undefined,
      action: previous.incidentOpen ? "resolve" : "none",
    };
  }

  const consecutiveFailures = previous.consecutiveFailures + 1;
  // Remember when this streak started so the incident's downtime is measured accurately.
  const failingSince = previous.failingSince ?? checkedAt;
  const shouldOpen = !previous.incidentOpen && consecutiveFailures >= threshold;
  return { consecutiveFailures, failingSince, action: shouldOpen ? "open" : "none" };
}
