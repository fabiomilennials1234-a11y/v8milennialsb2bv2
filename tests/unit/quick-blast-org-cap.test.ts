// @vitest-environment node
/**
 * orgBlastCap — Quick Blast org-level lead ceiling (ADR-0002).
 *
 * The cap is the ONLY safety guardrail (no role gate). It MUST fail closed:
 * any missing/invalid config resolves to the safe default, never unlimited.
 */

import { describe, it, expect } from "vitest";

const { resolveOrgCap, DEFAULT_BLAST_CAP } = await import(
  "../../supabase/functions/_shared/quick-blast/org-cap.ts"
);

describe("resolveOrgCap — fail-closed ceiling", () => {
  it("uses the default when config is null", () => {
    expect(resolveOrgCap(null)).toBe(DEFAULT_BLAST_CAP);
  });

  it("uses the default when config is undefined", () => {
    expect(resolveOrgCap(undefined)).toBe(DEFAULT_BLAST_CAP);
  });

  it("honors a positive integer ceiling", () => {
    expect(resolveOrgCap(50)).toBe(50);
  });

  it("fails closed to default on zero (would block all sends)", () => {
    expect(resolveOrgCap(0)).toBe(DEFAULT_BLAST_CAP);
  });

  it("fails closed to default on negative values", () => {
    expect(resolveOrgCap(-5)).toBe(DEFAULT_BLAST_CAP);
  });

  it("fails closed to default on NaN / Infinity", () => {
    expect(resolveOrgCap(Number.NaN)).toBe(DEFAULT_BLAST_CAP);
    expect(resolveOrgCap(Number.POSITIVE_INFINITY)).toBe(DEFAULT_BLAST_CAP);
  });

  it("floors fractional ceilings to an integer", () => {
    expect(resolveOrgCap(10.9)).toBe(10);
  });

  it("default is 200", () => {
    expect(DEFAULT_BLAST_CAP).toBe(200);
  });
});
