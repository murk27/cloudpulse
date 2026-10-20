/**
 * Tiny client for the CloudPulse API.
 *
 * All requests go to the same origin (/api/...): in AWS, CloudFront forwards /api/* to
 * API Gateway; locally, Vite's dev server proxies /api to scripts/local-server.ts.
 * Same origin means no CORS configuration is needed anywhere.
 */
import { useCallback, useEffect, useState } from "react";

const TOKEN_KEY = "cloudpulse.token";
/** Must match SESSION_HEADER in backend/handlers/api.ts. */
const SESSION_HEADER = "x-cloudpulse-token";

// sessionStorage: the login lasts until the browser tab is closed.
export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage can be blocked (private mode); the user just has to log in again.
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly details?: string[];

  constructor(status: number, message: string, details?: string[]) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export interface ApiResult<T> {
  data: T;
  response: Response;
  durationMs: number;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set(SESSION_HEADER, token);
  if (init.body) headers.set("content-type", "application/json");

  const started = performance.now();
  // "no-cache" = always ask the network (CloudFront may still answer from its edge cache).
  const response = await fetch(path, { cache: "no-cache", ...init, headers });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const durationMs = Math.round(performance.now() - started);

  if (!response.ok) {
    if (response.status === 401 && token) {
      // Session expired or password changed: forget the token and go to the login page.
      setToken(null);
      window.location.hash = "#/login";
    }
    const message =
      response.status === 429
        ? "Too many requests: API Gateway throttled this call. Wait a moment and try again."
        : String(body.error ?? `Request failed (${response.status})`);
    throw new ApiError(response.status, message, body.details as string[] | undefined);
  }
  return { data: body as T, response, durationMs };
}

interface ApiState<T> {
  data?: T;
  response?: Response;
  durationMs?: number;
  error?: string;
  loading: boolean;
}

/** React hook: loads `path` on mount and whenever reload() is called. */
export function useApi<T>(path: string) {
  const [state, setState] = useState<ApiState<T>>({ loading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    request<T>(path).then(
      ({ data, response, durationMs }) => {
        if (!cancelled) setState({ data, response, durationMs, loading: false });
      },
      (err: unknown) => {
        if (!cancelled) setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err), loading: false }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
