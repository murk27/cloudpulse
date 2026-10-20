import { describe, expect, it } from "vitest";
import { createSessionToken, safeEqual, verifySessionToken } from "../lib/auth.ts";

const NOW = Date.parse("2026-01-01T00:00:00Z");

describe("session tokens", () => {
  it("accepts a token signed with the same password", () => {
    const token = createSessionToken("hunter2", NOW);
    expect(verifySessionToken(token, "hunter2", NOW + 1000)).toBe(true);
  });

  it("rejects a token after the password changes", () => {
    const token = createSessionToken("hunter2", NOW);
    expect(verifySessionToken(token, "new-password", NOW + 1000)).toBe(false);
  });

  it("rejects an expired token", () => {
    const token = createSessionToken("hunter2", NOW);
    expect(verifySessionToken(token, "hunter2", NOW + 13 * 60 * 60 * 1000)).toBe(false);
  });

  it("rejects a token whose expiry was tampered with", () => {
    const [, signature] = createSessionToken("hunter2", NOW).split(".");
    const forged = `${NOW + 999_999_999}.${signature}`;
    expect(verifySessionToken(forged, "hunter2", NOW)).toBe(false);
  });

  it("rejects missing or malformed tokens", () => {
    expect(verifySessionToken(undefined, "hunter2", NOW)).toBe(false);
    expect(verifySessionToken("garbage", "hunter2", NOW)).toBe(false);
  });
});

describe("safeEqual", () => {
  it("compares strings of different lengths safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
