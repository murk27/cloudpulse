/**
 * Publishes custom CloudWatch metrics using the "Embedded Metric Format" (EMF).
 *
 * Instead of calling the CloudWatch API, we print one JSON line to the Lambda log.
 * CloudWatch spots the special "_aws" block and turns the values into metrics automatically.
 * That needs no extra permissions and no extra API calls.
 *
 * We publish exactly 3 metrics with a single fixed dimension, which keeps us inside the
 * Always Free allowance of 10 custom metrics.
 */

export interface RunMetrics {
  MonitorsUp: number;
  MonitorsDown: number;
  AvgLatencyMs: number;
}

export function publishRunMetrics(metrics: RunMetrics): void {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: "CloudPulse",
            Dimensions: [["Service"]],
            Metrics: [
              { Name: "MonitorsUp", Unit: "Count" },
              { Name: "MonitorsDown", Unit: "Count" },
              { Name: "AvgLatencyMs", Unit: "Milliseconds" },
            ],
          },
        ],
      },
      Service: "CloudPulse",
      ...metrics,
    }),
  );
}
