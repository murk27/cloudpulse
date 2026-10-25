/**
 * Route tests: call the real router (backend/app.ts) with standard Web Requests, exactly as
 * Vercel does, using the in-memory store. No server, no network.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handle, matchPath } from "../app.js";
import { MemoryKV, setKV } from "../lib/kv.js";

let ipCounter = 0;

/** Each request gets its own IP unless one is given, so rate limiting only kicks in when we want it. */
function call(method: string, path: string, options: { body?: unknown; token?: string; auth?: string; ip?: string } = {}) {
  const headers = new Headers({ "x-forwarded-for": options.ip ?? `10.0.0.${++ipCounter}` });
  if (options.token) headers.set("x-cloudpulse-token", options.token);
  if (options.auth) headers.set("authorization", options.auth);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return handle(
    new Request(`https://cloudpulse.test${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );
}

async function loginToken(): Promise<string> {
  const response = await call("POST", "/api/login", { body: { password: "test-password" } });
  return ((await response.json()) as { token: string }).token;
}

beforeAll(() => {
  process.env.ADMIN_PASSWORD = "test-password";
  process.env.CRON_SECRET = "test-cron-secret";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
});

beforeEach(() => setKV(new MemoryKV()));

describe("matchPath", () => {
  it("extracts :params and rejects other paths", () => {
    expect(matchPath("/api/monitors/:id", "/api/monitors/abc")).toEqual({ id: "abc" });
    expect(matchPath("/api/monitors/:id", "/api/monitors")).toBeNull();
    expect(matchPath("/api/status", "/api/status/")).toEqual({});
  });
});

describe("API routes", () => {
  it("serves the public status page with a CDN cache header", async () => {
    const response = await call("GET", "/api/status");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60");
    expect(((await response.json()) as { overall: string }).overall).toBe("unknown");
  });

  it("returns 404 for unknown routes", async () => {
    expect((await call("GET", "/api/nope")).status).toBe(404);
  });

  it("rejects wrong passwords and admin calls without a valid token", async () => {
    expect((await call("POST", "/api/login", { body: { password: "nope" } })).status).toBe(401);
    expect((await call("POST", "/api/login", { body: {} })).status).toBe(400);
    expect((await call("GET", "/api/monitors")).status).toBe(401);
    expect((await call("GET", "/api/monitors", { token: "123.forged" })).status).toBe(401);
  });

  it("lets an admin add, view and delete a monitor", async () => {
    const token = await loginToken();
    const bad = await call("POST", "/api/monitors", { token, body: { name: "", url: "ftp://x" } });
    expect(bad.status).toBe(400);

    const created = await call("POST", "/api/monitors", { token, body: { name: "Site", url: "https://site.test" } });
    expect(created.status).toBe(201);
    const { monitor } = (await created.json()) as { monitor: { id: string; expectedStatus: number } };
    expect(monitor.expectedStatus).toBe(200);

    expect((await call("GET", `/api/monitors/${monitor.id}`, { token })).status).toBe(200);
    expect((await call("DELETE", `/api/monitors/${monitor.id}`, { token })).status).toBe(200);
    expect((await call("GET", `/api/monitors/${monitor.id}`, { token })).status).toBe(404);
  });

  it("caps the number of monitors (free-tier guardrail)", async () => {
    const token = await loginToken();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await call("POST", "/api/monitors", { token, body: { name: `M${i}`, url: `https://m${i}.test` } })).status);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 201, 409]);
  });

  it("protects the cron route with CRON_SECRET", async () => {
    expect((await call("GET", "/api/cron/check")).status).toBe(401);
    expect((await call("GET", "/api/cron/check", { auth: "Bearer wrong" })).status).toBe(401);
    const ok = await call("GET", "/api/cron/check", { auth: "Bearer test-cron-secret" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { checked: number }).checked).toBe(0);
  });

  it("rate-limits an IP after 10 requests in 10 seconds", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await call("GET", "/api/status", { ip: "203.0.113.7" })).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it("switches the demo target website down and up", async () => {
    const token = await loginToken();
    expect((await call("GET", "/api/demo-target")).status).toBe(200);
    expect((await call("POST", "/api/demo-target", { body: { down: true } })).status).toBe(401);
    expect((await call("POST", "/api/demo-target", { token, body: { down: true } })).status).toBe(200);
    expect((await call("GET", "/api/demo-target")).status).toBe(503);
    await call("POST", "/api/demo-target", { token, body: { down: false } });
    expect((await call("GET", "/api/demo-target")).status).toBe(200);
  });
});
