/**
 * App shell: top navigation, page routes and footer.
 * Admin pages are wrapped in <RequireLogin>, which sends you to /login without a session.
 */
import { useState, type ReactNode } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router";
import { getToken, setToken } from "./lib/api.ts";
import { applyThemeChoice, getThemeChoice, nextTheme, type ThemeChoice } from "./lib/theme.ts";
import { ArchitecturePage } from "./pages/ArchitecturePage.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { MonitorPage } from "./pages/MonitorPage.tsx";
import { StatusPage } from "./pages/StatusPage.tsx";

function RequireLogin({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (!getToken()) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function NavItem({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-md px-3 py-1.5 text-sm ${isActive ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"}`
      }
    >
      {children}
    </NavLink>
  );
}

function ThemeButton() {
  const [choice, setChoice] = useState<ThemeChoice>(getThemeChoice);
  const labels: Record<ThemeChoice, string> = { system: "Theme: auto", light: "Theme: light", dark: "Theme: dark" };
  return (
    <button
      type="button"
      className="rounded-md px-2 py-1.5 text-xs text-ink-2 hover:text-ink"
      onClick={() => {
        const next = nextTheme(choice);
        applyThemeChoice(next);
        setChoice(next);
      }}
    >
      {labels[choice]}
    </button>
  );
}

export function App() {
  const navigate = useNavigate();
  useLocation(); // re-render on navigation so the Log in / Log out button stays current
  const loggedIn = Boolean(getToken());

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
          <Link to="/" className="mr-3 flex items-center gap-2 font-semibold text-ink">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            CloudPulse
          </Link>
          <nav className="flex flex-wrap items-center gap-1">
            <NavItem to="/status">Status</NavItem>
            <NavItem to="/dashboard">Dashboard</NavItem>
            <NavItem to="/architecture">Architecture</NavItem>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeButton />
            {loggedIn ? (
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm text-ink-2 hover:text-ink"
                onClick={() => {
                  setToken(null);
                  navigate("/status");
                }}
              >
                Log out
              </button>
            ) : (
              <NavItem to="/login">Log in</NavItem>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/architecture" element={<ArchitecturePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/dashboard"
            element={
              <RequireLogin>
                <DashboardPage />
              </RequireLogin>
            }
          />
          <Route
            path="/monitors/:id"
            element={
              <RequireLogin>
                <MonitorPage />
              </RequireLogin>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted">
          CloudPulse · serverless uptime monitoring on AWS (Lambda, DynamoDB, EventBridge, SNS, S3, CloudFront) ·{" "}
          <Link to="/architecture" className="underline hover:text-ink">
            how it works
          </Link>
        </div>
      </footer>
    </div>
  );
}
