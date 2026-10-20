/**
 * Admin authentication: one password, no user accounts.
 *
 * - The password lives in SSM Parameter Store as an encrypted SecureString (never in code or
 *   in the template). The Lambda reads it once per container and keeps it in memory.
 * - After a correct login we hand out a session token: "<expiry>.<HMAC signature>".
 *   The signature is computed with a key derived from the password, so nobody can forge
 *   or extend a token without knowing the password. Changing the password logs everyone out.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { config, limits } from "./config.ts";

let cachedPassword: string | undefined;

export async function getAdminPassword(): Promise<string> {
  const local = config.localAdminPassword();
  if (local) return local; // local development only

  if (!cachedPassword) {
    const ssm = new SSMClient({ region: config.region() });
    const result = await ssm.send(
      new GetParameterCommand({ Name: config.adminPasswordParam(), WithDecryption: true }),
    );
    if (!result.Parameter?.Value) throw new Error("Admin password parameter is empty");
    cachedPassword = result.Parameter.Value;
  }
  return cachedPassword;
}

/**
 * Compares two strings in constant time, so an attacker can't guess the password
 * character by character by measuring how long the comparison takes.
 * Hashing first makes both inputs the same length, which timingSafeEqual requires.
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

export function verifySessionToken(token: string | undefined, password: string, now: number = Date.now()): boolean {
  if (!token) return false;
  const [expiresPart, signature] = token.split(".");
  const expiresAt = Number(expiresPart);
  if (!signature || !Number.isFinite(expiresAt) || expiresAt < now) return false;
  return safeEqual(signature, sign(expiresAt, password));
}
