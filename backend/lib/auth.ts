/**
 * Authentication: an admin password for the dashboard, and a shared secret for the scheduler.
 *
 * - ADMIN_PASSWORD and CRON_SECRET are Vercel environment variables (stored encrypted, never in
 *   git or in the browser bundle).
 * - After a correct login we hand out a session token: "<expiry>.<HMAC signature>".
 *   The signature is computed with a key derived from the password, so nobody can forge
 *   or extend a token without knowing the password. Changing the password logs everyone out.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config, limits } from "./config.js";

export function getAdminPassword(): string {
  const password = config.adminPassword();
  if (!password) throw new Error("ADMIN_PASSWORD environment variable is not set");
  return password;
}

/**
 * Compares two strings in constant time, so an attacker can't guess a secret character by
 * character by measuring how long the comparison takes. Hashing first makes both inputs the
 * same length, which timingSafeEqual requires.
 */
export function safeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

function sign(expiresAt: number, password: string): string {
  const key = createHash("sha256").update(`cloudpulse-session|${password}`).digest();
  return createHmac("sha256", key).update(String(expiresAt)).digest("hex");
}

export function createSessionToken(password: string, now: number = Date.now()): string {
  const expiresAt = now + limits.sessionTtlMs;
  return `${expiresAt}.${sign(expiresAt, password)}`;
}

export function verifySessionToken(token: string | null | undefined, password: string, now: number = Date.now()): boolean {
  if (!token) return false;
  const [expiresPart, signature] = token.split(".");
  const expiresAt = Number(expiresPart);
  if (!signature || !Number.isFinite(expiresAt) || expiresAt < now) return false;
  return safeEqual(signature, sign(expiresAt, password));
}

/**
 * The scheduler (GitHub Actions, or Vercel Cron) must send "Authorization: Bearer <CRON_SECRET>".
 * Vercel Cron adds exactly this header automatically when CRON_SECRET is set.
 */
export function isCronAuthorized(authorizationHeader: string | null): boolean {
  const secret = config.cronSecret();
  if (!secret || !authorizationHeader) return false;
  return safeEqual(authorizationHeader, `Bearer ${secret}`);
}
