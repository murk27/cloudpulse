import { describe, expect, it } from "vitest";
import { evaluateCheck } from "../lib/incidents.js";

const T1 = "2026-01-01T10:00:00.000Z";
const T2 = "2026-01-01T10:05:00.000Z";

describe("evaluateCheck", () => {
  it("does nothing while a healthy monitor keeps passing", () => {
    const result = evaluateCheck({ consecutiveFailures: 0, incidentOpen: false }, true, T1);
    expect(result).toEqual({ consecutiveFailures: 0, failingSince: undefined, action: "none" });
  });

  it("does not open an incident after a single failure (avoids alerting on blips)", () => {
    const result = evaluateCheck({ consecutiveFailures: 0, incidentOpen: false }, false, T1);
    expect(result.action).toBe("none");
    expect(result.consecutiveFailures).toBe(1);
    expect(result.failingSince).toBe(T1);
  });

  it("opens an incident on the second failure in a row, dated from the first failure", () => {
    const result = evaluateCheck({ consecutiveFailures: 1, failingSince: T1, incidentOpen: false }, false, T2);
    expect(result).toEqual({ consecutiveFailures: 2, failingSince: T1, action: "open" });
  });

  it("does not open a second incident while one is already open", () => {
    const result = evaluateCheck({ consecutiveFailures: 5, failingSince: T1, incidentOpen: true }, false, T2);
    expect(result.action).toBe("none");
    expect(result.consecutiveFailures).toBe(6);
  });

  it("resolves the open incident on the next success and resets the streak", () => {
    const result = evaluateCheck({ consecutiveFailures: 3, failingSince: T1, incidentOpen: true }, true, T2);
    expect(result).toEqual({ consecutiveFailures: 0, failingSince: undefined, action: "resolve" });
  });

  it("respects a custom threshold", () => {
    const result = evaluateCheck({ consecutiveFailures: 1, incidentOpen: false }, false, T2, 3);
    expect(result.action).toBe("none");
  });
});
