/**
 * Local development server: runs the REAL API code (backend/app.ts) on your machine, offline.
 *
 *   1. Uses the in-memory store (MemoryKV) instead of Upstash Redis, and seeds it with demo data.
 *   2. Serves http://localhost:3001/api/* by turning each Node.js request into a standard Web
 *      Request and calling handle(), exactly what Vercel does with api/index.ts.
 *   3. Runs all checks every 5 minutes, like the GitHub Actions scheduler does in production.
 *
 * Vite (http://localhost:5173) proxies /api here. Alerts are printed instead of sent to Discord.
 * This is also an offline backup for your demo if the internet misbehaves.
 */
import { createServer, type IncomingMessage } from "node:http";

const PORT = Number(process.env.API_PORT ?? 3001);

// Local stand-ins for the environment variables you set on Vercel.
// The Redis variables are removed so the in-memory store is always used locally.
for (const name of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN", "DISCORD_WEBHOOK_URL"]) {
  delete process.env[name];
}
process.env.ADMIN_PASSWORD ??= "admin";
process.env.CRON_SECRET ??= "local-cron-secret";

async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined;
}

async function main(): Promise<void> {
  // Imported after the environment variables above are set.
  const { seedDatabase } = await import("./seed.js");
  const { handle } = await import("../backend/app.js");
  const { runAllChecks } = await import("../backend/lib/run-checks.js");

  await seedDatabase((msg) => console.log(`[seed] ${msg}`));

  const server = createServer(async (req, res) => {
    const started = Date.now();
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(",") : value);
    }
    headers.set("x-forwarded-for", req.socket.remoteAddress ?? "127.0.0.1");

    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const request = new Request(`http://localhost:${PORT}${req.url ?? "/"}`, { method: req.method, headers, body });

    const response = await handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    console.log(`${req.method} ${req.url} -> ${response.status} (${Date.now() - started} ms)`);
  });

  server.listen(PORT, () => {
    console.log(`\nLocal API ready on http://localhost:${PORT}  (admin password: "${process.env.ADMIN_PASSWORD}")`);
    console.log("Open the app at http://localhost:5173\n");
  });

  // The "scheduler": run all checks every 5 minutes.
  setInterval(() => {
    runAllChecks().catch((err: unknown) => console.error("[scheduler] run failed", err));
  }, 5 * 60 * 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
