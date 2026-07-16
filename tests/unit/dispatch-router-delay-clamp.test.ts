// @vitest-environment node
/**
 * clampSenderDelays — server-side floor for the Uazapi /sender inter-message
 * delay (anti-ban Onda 0 QW2).
 *
 * All /sender/advanced exits converge on runUazapiSenderJob, so this single
 * clamp covers Quick Blast, Blast Plan and Mass Send regardless of what the
 * client sent (stale frontend, direct API, 0/0, omitted, garbage).
 */
import { describe, it, expect } from "vitest";

const { clampSenderDelays, MIN_SENDER_DELAY_MS } = await import(
  "../../supabase/functions/_shared/dispatch-router.ts"
);

describe("clampSenderDelays", () => {
  it("floors delayMin at 3000ms regardless of the client value", () => {
    expect(clampSenderDelays(500, 4000)).toEqual({ delayMin: 3000, delayMax: 4000 });
    expect(clampSenderDelays(0, 0)).toEqual({ delayMin: 3000, delayMax: 3000 });
    expect(clampSenderDelays(-100, 200)).toEqual({ delayMin: 3000, delayMax: 3000 });
  });

  it("keeps compliant values untouched", () => {
    expect(clampSenderDelays(5000, 30000)).toEqual({ delayMin: 5000, delayMax: 30000 });
    expect(clampSenderDelays(3000, 3000)).toEqual({ delayMin: 3000, delayMax: 3000 });
  });

  it("guarantees delayMax >= delayMin (inverted pairs collapse to the min)", () => {
    expect(clampSenderDelays(10000, 4000)).toEqual({ delayMin: 10000, delayMax: 10000 });
    expect(clampSenderDelays(5000, undefined)).toEqual({ delayMin: 5000, delayMax: 5000 });
  });

  it("resolves omitted/garbage values to the floor instead of passing through to Uazapi's unknown default", () => {
    expect(clampSenderDelays(undefined, undefined)).toEqual({ delayMin: 3000, delayMax: 3000 });
    expect(clampSenderDelays(NaN, NaN)).toEqual({ delayMin: 3000, delayMax: 3000 });
    expect(clampSenderDelays(Infinity, 100)).toEqual({ delayMin: 3000, delayMax: 3000 });
  });

  it("floors fractional values", () => {
    expect(clampSenderDelays(4500.9, 30000.7)).toEqual({ delayMin: 4500, delayMax: 30000 });
  });

  it("exports the floor constant used by the UI floor (3s)", () => {
    expect(MIN_SENDER_DELAY_MS).toBe(3000);
  });
});
