/** Architecture page: the diagram plus a short caption for every numbered component. */
import { ArchitectureDiagram, GROUPS, NODES } from "../components/ArchitectureDiagram.js";

const CAPTIONS: Record<number, { what: string; free?: string }> = {
  1: { what: "The React app runs in your browser. It only ever calls /api on the same domain, so no CORS setup is needed." },
  2: {
    what: "Vercel's global edge network. It serves the built website from locations near each visitor over HTTPS, and caches the public /api/status response for 60 seconds (s-maxage).",
    free: "Hobby plan: free for personal projects",
  },
  3: {
    what: "One serverless function handles every API route. It starts on demand, scales automatically, and nothing runs (or costs anything) between requests.",
    free: "Hobby: 1M invocations + 4 CPU-hours / month",
  },
  4: {
    what: "Serverless Redis over HTTPS: hashes for monitors, sorted sets (scored by time) for checks, counters for daily uptime, and atomic SET NX to prevent duplicate incidents. It also stores the rate-limit counters.",
    free: "Free: 500,000 commands + 256 MB",
  },
  5: {
    what: "ADMIN_PASSWORD, CRON_SECRET, the Redis credentials and the Discord URL live in Vercel's encrypted environment variables. Nothing secret is in git or in the browser bundle.",
  },
  6: { what: "Alerts are posted to a Discord channel through an incoming webhook: a plain HTTPS POST with a JSON message." },
  7: { what: "The sites being monitored: anything reachable on the public internet (plus a built-in fake site for the outage demo)." },
  8: {
    what: "A scheduled workflow calls /api/cron/check every 5 minutes with a secret bearer token. Vercel's free plan only allows daily crons, so the frequent schedule lives here.",
    free: "Free for public repositories",
  },
  9: { what: "A daily Vercel Cron Job calls the same endpoint as a backup, in case GitHub's scheduler skips runs." },
  10: { what: "Everything the function prints (one JSON line per check run, errors with stack traces) appears in the Vercel dashboard's runtime logs." },
  11: { what: "On every push: lint, type-check, unit and integration tests, and a production build. A broken commit is caught before it ships." },
  12: {
    what: "Vercel's Git integration: every push to main becomes a new production deployment, and other branches get preview URLs. vercel.json holds the config as code.",
  },
};

export function ArchitecturePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Architecture</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Everything is serverless and managed: nothing runs between requests, and every component scales by itself. Under the
          hood Vercel Functions run on AWS Lambda, but Vercel takes care of all the configuration.
        </p>
      </div>

      <section className="rounded-xl border border-line bg-surface p-4">
        <ArchitectureDiagram />
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 px-2 text-xs text-ink-2">
          {Object.values(GROUPS).map((g) => (
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
