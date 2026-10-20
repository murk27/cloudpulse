/**
 * Local development server: runs the REAL Lambda code on your machine, with no AWS account.
 *
 *   1. Starts dynalite (an in-memory DynamoDB clone) and creates the same table as template.yaml.
 *   2. Seeds it with demo data.
 *   3. Serves http://localhost:3001/api/* by turning each request into an API Gateway event and
 *      calling the api Lambda handler, just as API Gateway does in AWS.
 *   4. Runs the checker every 5 minutes, just as EventBridge Scheduler does in AWS.
 *
 * Vite (http://localhost:5173) proxies /api here. Alerts are printed instead of emailed.
 * This is also an offline backup for your demo if the internet or AWS misbehaves.
 */
import { createServer, type IncomingMessage } from "node:http";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import dynalite from "dynalite";

const API_PORT = Number(process.env.API_PORT ?? 3001);
const DYNAMO_PORT = Number(process.env.DYNAMO_PORT ?? 4567);

// These environment variables replace what template.yaml sets on the Lambda functions in AWS.
process.env.TABLE_NAME = "cloudpulse-local";
process.env.DYNAMODB_ENDPOINT = `http://localhost:${DYNAMO_PORT}`;
process.env.AWS_REGION = "us-east-1";
process.env.ADMIN_PASSWORD ??= "admin";

/** Must stay in sync with the ApiFunction events in template.yaml. */
const ROUTES = [
  "GET /api/status",
  "POST /api/login",
  "GET /api/monitors",
  "POST /api/monitors",
  "GET /api/monitors/{id}",
  "DELETE /api/monitors/{id}",
  "POST /api/check-now",
];

function matchRoute(method: string, path: string) {
  for (const routeKey of ROUTES) {
    const [routeMethod, pattern] = routeKey.split(" ") as [string, string];
    if (routeMethod !== method) continue;
    const names: string[] = [];
    const regex = new RegExp(
      "^" +
        pattern.replace(/\{(\w+)\}/g, (_m, name: string) => {
          names.push(name);
          return "([^/]+)";
        }) +
        "$",
    );
    const match = regex.exec(path);
    if (!match) continue;
    const pathParameters = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(match[i + 1] ?? "")]));
    return { routeKey, pathParameters };
  }
  return null;
}

/** Mimics the API Gateway throttle in template.yaml (10 req/s, burst 20) so 429s show up locally too. */
const throttle = { tokens: 20, last: Date.now() };
function allowRequest(): boolean {
  const now = Date.now();
  throttle.tokens = Math.min(20, throttle.tokens + ((now - throttle.last) / 1000) * 10);
  throttle.last = now;
  if (throttle.tokens < 1) return false;
  throttle.tokens -= 1;
  return true;
}

async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined;
}

async function main(): Promise<void> {
  // 1. In-memory DynamoDB
  const dynamo = dynalite({ createTableMs: 0, deleteTableMs: 0, updateTableMs: 0 });
  await new Promise<void>((resolve) => dynamo.listen(DYNAMO_PORT, () => resolve()));
  const raw = new DynamoDBClient({
    endpoint: process.env.DYNAMODB_ENDPOINT,
    region: "us-east-1",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  await raw.send(
    new CreateTableCommand({
      TableName: process.env.TABLE_NAME,
      BillingMode: "PROVISIONED",
      ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 10 },
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
    }),
  );

  // 2. Demo data. Handlers are imported only now, after the environment variables are set.
  const { seedDatabase } = await import("./seed.ts");
  await seedDatabase((msg) => console.log(`[seed] ${msg}`));
  const { handler } = await import("../backend/handlers/api.ts");
  const { runAllChecks } = await import("../backend/lib/run-checks.ts");

  // 3. HTTP server that behaves like API Gateway
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${API_PORT}`);
    const method = req.method ?? "GET";
    const started = Date.now();
    const route = matchRoute(method, url.pathname);

    let status: number;
    let headers: Record<string, string>;
    let body: string;

    if (!route) {
      [status, headers, body] = [404, { "content-type": "application/json" }, JSON.stringify({ message: "Not Found" })];
    } else if (!allowRequest()) {
      [status, headers, body] = [429, { "content-type": "application/json" }, JSON.stringify({ message: "Too Many Requests" })];
    } else {
      const requestHeaders: Record<string, string> = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if (value !== undefined) requestHeaders[name.toLowerCase()] = Array.isArray(value) ? value.join(",") : value;
      }
      const event = {
        version: "2.0",
        routeKey: route.routeKey,
        rawPath: url.pathname,
        rawQueryString: url.search.slice(1),
        headers: requestHeaders,
        pathParameters: route.pathParameters,
        body: await readBody(req),
        isBase64Encoded: false,
        requestContext: { http: { method, path: url.pathname, sourceIp: req.socket.remoteAddress ?? "" } },
      } as unknown as APIGatewayProxyEventV2;

      const result = await handler(event);
      status = result.statusCode ?? 200;
      headers = Object.fromEntries(Object.entries(result.headers ?? {}).map(([k, v]) => [k, String(v)]));
      body = result.body ?? "";
    }

    res.writeHead(status, headers).end(body);
    console.log(`${method} ${url.pathname} -> ${status} (${Date.now() - started} ms)`);
  });
  server.listen(API_PORT, () => {
    console.log(`\nLocal API ready on http://localhost:${API_PORT}  (admin password: "${process.env.ADMIN_PASSWORD}")`);
    console.log("Open the app at http://localhost:5173\n");
  });

  // 4. The "scheduler": run all checks every 5 minutes
  setInterval(() => {
    runAllChecks()
      .then((summary) => console.log(`[scheduler] checked ${summary.checked}: ${summary.up} up, ${summary.down} down`))
      .catch((err: unknown) => console.error("[scheduler] run failed", err));
  }, 5 * 60 * 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
