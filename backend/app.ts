/**
 * The whole HTTP API: one small router that Vercel runs as a single function (api/index.ts).
 *
 * vercel.json rewrites every /api/* request to that function, and handle() picks the route by
 * method + path. Keeping all routes in one function means one warm instance can serve them all
 * (fewer cold starts), which is what Vercel recommends.
 *
 *   Public:  GET    /api/status          status page data (cached by Vercel's CDN for 60 s)
 *            POST   /api/login
 *            GET    /api/demo-target     a fake website for the live outage demo
 *   Admin:   GET    /api/monitors
 *            POST   /api/monitors
 *            GET    /api/monitors/:id
 *            DELETE /api/monitors/:id
 *            POST   /api/check-now       the "Run check now" button
 *            POST   /api/demo-target     switch the fake website down / up
 *   Cron:    GET    /api/cron/check      called every 5 min with "Authorization: Bearer <CRON_SECRET>"
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Monitor, MonitorDetailResponse, OverallStatus, StatusPageMonitor, StatusPageResponse } from "../shared/types.js";
import { createSessionToken, getAdminPassword, isCronAuthorized, safeEqual, verifySessionToken } from "./lib/auth.js";
import { config, limits } from "./lib/config.js";
import {
  createMonitor,
  deleteMonitor,
  getChecksSince,
  getDailyRollups,
  getIncidents,
  getMonitor,
  isDemoTargetDown,
  listMonitors,
  setDemoTargetDown,
} from "./lib/db.js";
import { checkRateLimit, clientIp } from "./lib/rate-limit.js";
import { error, json } from "./lib/responses.js";
import { runAllChecks } from "./lib/run-checks.js";
import { buildUptimeBars, utcDate } from "./lib/stats.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The admin session token travels in this header (the frontend keeps it in sessionStorage). */
export const SESSION_HEADER = "x-cloudpulse-token";

type Access = "public" | "admin" | "cron";

interface Route {
  method: string;
  path: string; // ":name" segments become params
  access: Access;
  rateLimited: boolean;
  run: (request: Request, params: Record<string, string>) => Promise<Response>;
}

const routes: Route[] = [
  { method: "GET", path: "/api/status", access: "public", rateLimited: true, run: statusPage },
  { method: "POST", path: "/api/login", access: "public", rateLimited: true, run: login },
  { method: "GET", path: "/api/demo-target", access: "public", rateLimited: false, run: demoTarget },
  { method: "GET", path: "/api/monitors", access: "admin", rateLimited: false, run: async () => json(200, { monitors: await listMonitors() }) },
  { method: "POST", path: "/api/monitors", access: "admin", rateLimited: true, run: addMonitor },
  { method: "GET", path: "/api/monitors/:id", access: "admin", rateLimited: false, run: monitorDetail },
  { method: "DELETE", path: "/api/monitors/:id", access: "admin", rateLimited: true, run: removeMonitor },
  { method: "POST", path: "/api/check-now", access: "admin", rateLimited: true, run: async () => json(200, await runAllChecks()) },
  { method: "POST", path: "/api/demo-target", access: "admin", rateLimited: true, run: switchDemoTarget },
  { method: "GET", path: "/api/cron/check", access: "cron", rateLimited: false, run: cronCheck },
];

/** Entry point for every API request. Returns a standard Web Response. */
export async function handle(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const match = findRoute(request.method, pathname);
  if (!match) return error(404, `No route for ${request.method} ${pathname}`);
  const { route, params } = match;

  try {
    if (route.rateLimited) {
      const limit = await checkRateLimit(clientIp(request));
      if (!limit.allowed) {
        return error(429, "Too many requests", undefined, { "retry-after": String(limit.retryAfterSeconds) });
      }
    }
    if (route.access === "admin") {
      if (!config.adminPassword()) return error(503, "Server is missing the ADMIN_PASSWORD environment variable");
      if (!verifySessionToken(request.headers.get(SESSION_HEADER), getAdminPassword())) {
        return error(401, "Not logged in or session expired");
      }
    }
    if (route.access === "cron" && !isCronAuthorized(request.headers.get("authorization"))) {
      return error(401, "Missing or wrong CRON_SECRET");
    }
    return await route.run(request, params);
  } catch (err) {
    // Full details go to the logs; the caller gets a generic message.
    console.error("Unhandled error", err);
    return error(500, "Internal server error");
  }
}

function findRoute(method: string, pathname: string) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchPath(route.path, pathname);
    if (params) return { route, params };
  }
  return null;
}

/** matchPath("/api/monitors/:id", "/api/monitors/abc") -> { id: "abc" }; no match -> null. */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const expected = pattern.split("/");
  const actual = pathname.replace(/\/+$/, "").split("/");
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < expected.length; i++) {
    const part = expected[i]!;
    if (part.startsWith(":")) params[part.slice(1)] = decodeURIComponent(actual[i]!);
    else if (part !== actual[i]) return null;
  }
  return params;
}

// ---------------------------------------------------------------- public routes

/** Public status page data. Vercel's CDN caches this response for 60 seconds. */
async function statusPage(): Promise<Response> {
  const monitors = await listMonitors();
  const today = new Date();
  const since = utcDate(new Date(today.getTime() - 89 * DAY_MS));

  const rows: StatusPageMonitor[] = await Promise.all(
    monitors.map(async (m) => ({
      id: m.id,
      name: m.name,
      status: m.status,
      uptime24h: m.stats?.uptime24h ?? null,
      lastCheckedAt: m.lastCheckedAt,
      days: buildUptimeBars(await getDailyRollups(m.id, since), today),
    })),
  );

  const body: StatusPageResponse = { overall: overallStatus(monitors), generatedAt: today.toISOString(), monitors: rows };
  // s-maxage=60: the CDN (a shared cache) may reuse this response for 60 seconds.
  // max-age=0:   browsers must not, so every page load really asks the CDN (HIT/MISS demo).
  return json(200, body, { "cache-control": "public, max-age=0, s-maxage=60" });
}

export function overallStatus(monitors: Pick<Monitor, "status">[]): OverallStatus {
  const checked = monitors.filter((m) => m.status !== "pending");
  if (checked.length === 0) return "unknown";
  const down = checked.filter((m) => m.status === "down").length;
  if (down === 0) return "operational";
  return down === checked.length ? "outage" : "degraded";
}

const LoginBody = z.object({ password: z.string().min(1).max(200) });

async function login(request: Request): Promise<Response> {
  const parsed = LoginBody.safeParse(await readJson(request));
  if (!parsed.success) return error(400, "Password is required");
  const password = config.adminPassword();
  if (!password) return error(503, "Server is missing the ADMIN_PASSWORD environment variable");
  if (!safeEqual(parsed.data.password, password)) return error(401, "Wrong password");
  return json(200, { token: createSessionToken(password) });
}

/** A fake website you control: returns 503 while the demo switch is "down", 200 otherwise. */
async function demoTarget(): Promise<Response> {
  const down = await isDemoTargetDown();
  return json(down ? 503 : 200, { status: down ? "down" : "up" });
}

// ---------------------------------------------------------------- admin routes

const NewMonitorBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  url: z.url({ protocol: /^https?$/, error: "Must be a valid http(s) URL" }),
  expectedStatus: z.coerce.number().int().min(100).max(599).default(200),
});

async function addMonitor(request: Request): Promise<Response> {
  const parsed = NewMonitorBody.safeParse(await readJson(request));
  if (!parsed.success) {
    return error(400, "Invalid monitor", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const existing = await listMonitors();
  if (existing.length >= limits.maxMonitors) {
    return error(409, `Limit of ${limits.maxMonitors} monitors reached (keeps the project inside the free tier)`);
  }
  const monitor = { id: randomUUID().split("-")[0]!, ...parsed.data, createdAt: new Date().toISOString() };
  await createMonitor(monitor);
  return json(201, { monitor });
}

async function monitorDetail(_request: Request, params: Record<string, string>): Promise<Response> {
  const id = params.id!;
  const monitor = await getMonitor(id);
  if (!monitor) return error(404, "Monitor not found");
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const [checks, incidents] = await Promise.all([getChecksSince(id, since, { newestFirst: true }), getIncidents(id)]);
  const body: MonitorDetailResponse = { monitor, checks, incidents };
  return json(200, body);
}

async function removeMonitor(_request: Request, params: Record<string, string>): Promise<Response> {
  const deleted = await deleteMonitor(params.id!);
  return deleted ? json(200, { deleted: params.id }) : error(404, "Monitor not found");
}

const DemoSwitchBody = z.object({ down: z.boolean() });

async function switchDemoTarget(request: Request): Promise<Response> {
  const parsed = DemoSwitchBody.safeParse(await readJson(request));
  if (!parsed.success) return error(400, 'Body must be {"down": true} or {"down": false}');
  await setDemoTargetDown(parsed.data.down);
  return json(200, { down: parsed.data.down });
}

// ---------------------------------------------------------------- cron route

/**
 * Runs every check. Returns HTTP 500 if any monitor couldn't be recorded, so the scheduler sees a
 * failure (GitHub then marks the workflow run red and emails the repository owner).
 */
async function cronCheck(): Promise<Response> {
  const summary = await runAllChecks();
  return json(summary.errors.length ? 500 : 200, summary);
}

// ---------------------------------------------------------------- helpers

/** Parses a JSON body; returns {} for an empty body and null for invalid JSON. */
async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
