/** Admin login: sends the password to POST /api/login and stores the returned session token. */
import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { request, setToken } from "../lib/api.ts";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await request<{ token: string }>("/api/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setToken(data.token);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? "/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-semibold text-ink">Admin login</h1>
      <p className="mt-1 text-sm text-ink-2">
        The password is stored encrypted in AWS Systems Manager Parameter Store.
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-xl border border-line bg-surface p-5">
        <label className="block text-sm">
          <span className="text-ink-2">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 text-ink outline-none focus:border-accent"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-ink">
            <span className="text-critical">▲</span> {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Checking…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
