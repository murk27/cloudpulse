/**
 * Lambda #1: the HTTP API.
 *
 * API Gateway sends every /api/* request to this one function. `event.routeKey` tells us which
 * route matched (for example "GET /api/monitors/{id}"), and we switch on it. The same routes
 * are declared in template.yaml under ApiFunction -> Events, and API Gateway rejects anything else.
 *
 *   Public:  GET  /api/status          (cached by CloudFront for 60 s)
 *            POST /api/login
 *   Admin:   GET  /api/monitors
 *            POST /api/monitors
 *            GET  /api/monitors/{id}
 *            DELETE /api/monitors/{id}
 *            POST /api/check-now
 */
import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { z } from "zod";
import type {
  Monitor,
  MonitorDetailResponse,
  OverallStatus,
  StatusPageMonitor,
  StatusPageResponse,
} from "../../shared/types.ts";
import { createSessionToken, getAdminPassword, safeEqual, verifySessionToken } from "../lib/auth.ts";
import { limits } from "../lib/config.ts";
import {
  createMonitor,
  deleteMonitor,
  getChecksSince,
  getDailyRollups,
  getIncidents,
  getMonitor,
  listMonitors,
} from "../lib/db.ts";
import { error, json, type ApiResponse } from "../lib/responses.ts";
import { runAllChecks } from "../lib/run-checks.ts";
import { buildUptimeBars, utcDate } from "../lib/stats.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The admin session token travels in this custom header. We don't use "Authorization"
 * because CloudFront strips that header from GET requests unless it is part of the cache key.
 */
export const SESSION_HEADER = "x-cloudpulse-token";

export async function handler(event: APIGatewayProxyEventV2): Promise<ApiResponse> {
  try {
    // Public routes
    switch (event.routeKey) {
      case "GET /api/status":
        return await statusPage();
      case "POST /api/login":
        return await login(event);
    }

    // Every other route needs a valid admin session.
    const password = await getAdminPassword();
    if (!verifySessionToken(event.headers[SESSION_HEADER], password)) {
      return error(401, "Not logged in or session expired");
    }

    switch (event.routeKey) {
      case "GET /api/monitors":
        return json(200, { monitors: await listMonitors() });
      case "POST /api/monitors":
        return await addMonitor(event);
      case "GET /api/monitors/{id}":
        return await monitorDetail(event.pathParameters?.id);
      case "DELETE /api/monitors/{id}":
        return await removeMonitor(event.pathParameters?.id);
      case "POST /api/check-now":
        return json(200, await runAllChecks());
      default:
        return error(404, `No route for ${event.routeKey}`);
    }
  } catch (err) {
    // Full details go to CloudWatch Logs; the caller gets a generic message.
    console.error("Unhandled error", err);
    return error(500, "Internal server error");
  }
}

// ---------------------------------------------------------------- public routes

/** Public status page data. CloudFront caches this response for 60 seconds. */
async function statusPage(): Promise<ApiResponse> {
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

  const body: StatusPageResponse = {
    overall: overallStatus(monitors),
    generatedAt: today.toISOString(),
    monitors: rows,
  };
  // "public, max-age=60" tells CloudFront (and browsers) they may reuse this for 60 seconds.
  return json(200, body, { "cache-control": "public, max-age=60" });
}

export function overallStatus(monitors: Pick<Monitor, "status">[]): OverallStatus {
  const checked = monitors.filter((m) => m.status !== "pending");
  if (checked.length === 0) return "unknown";
  const down = checked.filter((m) => m.status === "down").length;
  if (down === 0) return "operational";
  return down === checked.length ? "outage" : "degraded";
}

const LoginBody = z.object({ password: z.string().min(1).max(200) });

async function login(event: APIGatewayProxyEventV2): Promise<ApiResponse> {
  const parsed = LoginBody.safeParse(parseJsonBody(event));
  if (!parsed.success) return error(400, "Password is required");

  const password = await getAdminPassword();
  if (!safeEqual(parsed.data.password, password)) return error(401, "Wrong password");

  return json(200, { token: createSessionToken(password) });
}

// ---------------------------------------------------------------- admin routes

const NewMonitorBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  url: z.url({ protocol: /^https?$/, error: "Must be a valid http(s) URL" }),
  expectedStatus: z.coerce.number().int().min(100).max(599).default(200),
});

async function addMonitor(event: APIGatewayProxyEventV2): Promise<ApiResponse> {
  const parsed = NewMonitorBody.safeParse(parseJsonBody(event));
  if (!parsed.success) {
    return error(400, "Invalid monitor", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }

  const existing = await listMonitors();
  if (existing.length >= limits.maxMonitors) {
    return error(409, `Limit of ${limits.maxMonitors} monitors reached (keeps the project inside the free tier)`);
  }

  const monitor: Monitor = {
    id: randomUUID().split("-")[0]!,
    ...parsed.data,
    createdAt: new Date().toISOString(),
    status: "pending",
    consecutiveFailures: 0,
    stats: { uptime24h: null, avgLatencyMs: null, p95LatencyMs: null, sparkline: [] },
  };
  await createMonitor(monitor);
  return json(201, { monitor });
}

async function monitorDetail(id: string | undefined): Promise<ApiResponse> {
  if (!id) return error(400, "Missing monitor id");
  const monitor = await getMonitor(id);
  if (!monitor) return error(404, "Monitor not found");

  const since = new Date(Date.now() - DAY_MS).toISOString();
  const [checks, incidents] = await Promise.all([
    getChecksSince(id, since, { newestFirst: true }),
    getIncidents(id),
  ]);
  const body: MonitorDetailResponse = { monitor, checks, incidents };
  return json(200, body);
}

async function removeMonitor(id: string | undefined): Promise<ApiResponse> {
  if (!id) return error(400, "Missing monitor id");
  const deleted = await deleteMonitor(id);
  return deleted ? json(200, { deleted: id }) : error(404, "Monitor not found");
}

// ---------------------------------------------------------------- helpers

/** API Gateway may base64-encode the body; returns null if it isn't valid JSON. */
function parseJsonBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
