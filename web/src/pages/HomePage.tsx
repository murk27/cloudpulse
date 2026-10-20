/** Landing page: what CloudPulse is, with links to the three main views. */
import { Link } from "react-router";

const CARDS = [
  { to: "/status", title: "Public status page", text: "Live state of every monitor and 90-day uptime history, served from the CloudFront cache." },
  { to: "/dashboard", title: "Admin dashboard", text: "Add and remove monitors, see uptime, average and p95 latency, and run checks on demand." },
  { to: "/architecture", title: "Architecture", text: "How the AWS services fit together, with a short explanation of each one." },
];

const FLOW = [
  "EventBridge Scheduler wakes a Lambda function every 5 minutes.",
  "The Lambda checks every website in parallel and stores the results in DynamoDB.",
  "Two failures in a row open an incident and SNS emails you. Recovery sends another email.",
  "The website is static files in S3, delivered worldwide over HTTPS by CloudFront.",
];

export function HomePage() {
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Is your website up? CloudPulse knows.</h1>
        <p className="max-w-2xl text-lg text-ink-2">
          A serverless uptime and latency monitor built entirely on AWS managed services. There are no servers to run, and it
          fits inside the AWS free tier.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link to="/status" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90">
            View status page
          </Link>
          <Link to="/dashboard" className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2">
            Open dashboard
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {CARDS.map((card) => (
          <Link key={card.to} to={card.to} className="rounded-xl border border-line bg-surface p-5 hover:bg-surface-2">
            <h2 className="font-semibold text-ink">{card.title}</h2>
            <p className="mt-2 text-sm text-ink-2">{card.text}</p>
          </Link>
        ))}
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold text-ink">How it works</h2>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
          {FLOW.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
