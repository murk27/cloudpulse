/**
 * Lambda #2: the scheduled checker.
 *
 * EventBridge Scheduler invokes this function every 5 minutes (see CheckerFunction in
 * template.yaml). There is no server running in between: AWS starts the function, it checks
 * every monitor, and it stops. You pay (nothing, on the free tier) only for those seconds.
 */
import type { RunSummary } from "../../shared/types.ts";
import { runAllChecks } from "../lib/run-checks.ts";

export async function handler(): Promise<RunSummary> {
  const summary = await runAllChecks();
  console.log(JSON.stringify({ message: "Check run finished", ...summary }));

  // Throwing marks this invocation as failed. The "CheckerErrors" CloudWatch alarm watches
  // for that and emails you, so the monitoring system is itself monitored.
  if (summary.errors.length > 0) {
    throw new Error(`${summary.errors.length} monitor(s) could not be recorded: ${summary.errors.join("; ")}`);
  }
  return summary;
}
