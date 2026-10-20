/**
 * Helpers for building API Gateway (HTTP API) responses.
 */
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export type ApiResponse = APIGatewayProxyStructuredResultV2;

/**
 * JSON response. By default responses must NOT be cached: they contain admin data.
 * Routes that may be cached by CloudFront (only /api/status) pass their own Cache-Control.
 */
export function json(statusCode: number, body: unknown, headers: Record<string, string> = {}): ApiResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
    body: JSON.stringify(body),
  };
}

export function error(statusCode: number, message: string, details?: unknown): ApiResponse {
  return json(statusCode, { error: message, ...(details ? { details } : {}) });
}
