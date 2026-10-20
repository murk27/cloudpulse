/** Architecture page: the diagram plus a short caption for every numbered component. */
import { ArchitectureDiagram, GROUPS, NODES } from "../components/ArchitectureDiagram.tsx";

const CAPTIONS: Record<number, { what: string; free?: string }> = {
  1: { what: "The React app runs in your browser. It only ever calls /api on the same domain, so no CORS setup is needed." },
  2: {
    what: "AWS's content delivery network. It serves the site from edge locations near each visitor, adds HTTPS, sends /api/* to API Gateway, and caches /api/status for 60 seconds.",
    free: "Always free: 1 TB transfer + 10M requests / month",
  },
  3: {
    what: "The API's front door. It matches each route, invokes Lambda, and throttles traffic (10 req/s, bursts of 20). Anything above that gets HTTP 429 before reaching Lambda.",
    free: "Pennies per million requests (covered by Free-plan credits)",
  },
  4: {
    what: "One function handles every API route by switching on the route key. It only runs while a request is being served, so there's no idle server.",
    free: "Always free: 1M requests + 400,000 GB-seconds / month",
  },
  5: {
    what: "Stores the admin password as an encrypted SecureString. The Lambda's IAM role may read exactly this one parameter.",
    free: "Standard parameters are free",
  },
  6: {
    what: "A private bucket holding the built website. Only this CloudFront distribution can read it, via Origin Access Control. The bucket is never public.",
  },
  7: {
    what: "Serverless NoSQL. One table stores monitors, checks, daily rollups and incidents. TTL automatically deletes checks after 90 days.",
    free: "Always free: 25 GB + 25 read / 25 write capacity units (we use 10 + 10)",
  },
  8: {
    what: "Managed cron. It invokes the checker every 5 minutes, and nothing runs between invocations.",
    free: "Always free: 14M invocations / month",
  },
  9: {
    what: "Checks every URL in parallel with a 10-second timeout, saves the results, and opens or closes incidents. Conditional writes stop overlapping runs from creating duplicate incidents.",
  },
  10: { what: "The sites being monitored: anything reachable on the public internet." },
  11: {
    what: "Observability: logs (kept 7 days), custom metrics written as Embedded Metric Format log lines, a dashboard, and an alarm that fires if the checker itself fails.",
    free: "Always free: 10 custom metrics, 10 alarms, 3 dashboards",
  },
  12: {
    what: "Pub/sub messaging. The checker publishes one message and SNS delivers it to every subscriber, which here is your email address.",
    free: "Always free: 1,000 email deliveries / month",
  },
  13: { what: "Receives DOWN alerts after 2 failed checks in a row, and a RECOVERED email with the total downtime." },
  14: {
    what: "Infrastructure as code. template.yaml describes every resource above, and one `sam deploy` creates or updates the whole stack.",
    free: "CloudFormation is free",
  },
  15: { what: "CI: every push runs lint, type-check, unit tests, the build, and a template validation." },
};

export function ArchitecturePage() {
  const legendGroups = Object.values(GROUPS);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Architecture</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Everything is serverless and managed by AWS: nothing runs between requests, and every component scales by itself. The
          whole stack is defined in one SAM template.
        </p>
      </div>

      <section className="rounded-xl border border-line bg-surface p-4">
        <ArchitectureDiagram />
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 px-2 text-xs text-ink-2">
          {legendGroups.map((g) => (
            <span key={g.label} className="inline-flex items-center gap-1.5">
              {g.dashed ? (
                <span className="inline-block h-3 w-4 rounded-sm border border-dashed border-muted" />
              ) : (
                <span className="inline-block h-3 w-1 rounded-sm" style={{ background: g.color }} />
              )}
              {g.label}
            </span>
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {NODES.map((node) => {
          const caption = CAPTIONS[node.n];
          return (
            <div key={node.n} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold text-ink-2">
                  {node.n}
                </span>
                <h2 className="font-semibold text-ink">{node.title}</h2>
              </div>
              <p className="mt-2 text-sm text-ink-2">{caption?.what}</p>
              {caption?.free && <p className="mt-2 text-xs text-muted">{caption.free}</p>}
            </div>
          );
        })}
      </section>
    </div>
  );
}
