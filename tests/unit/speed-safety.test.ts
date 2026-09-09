/**
 * speed-safety — pure cap/risk math for the Velocidade step (ADR-0015, #908).
 *
 * One user-facing slider sets the Number Daily Cap applied to every selected
 * number; a number flagged "new" is auto-clamped to a lower effective cap
 * regardless of the slider; the slider's safe/risk zone is derived from the
 * recommended value. Pure helpers so the rules are testable without the UI.
 */
import { describe, it, expect } from "vitest";
import {
  effectiveCap,
  capRisk,
  clampCap,
  CAP_MIN,
  CAP_MAX,
  CAP_RECOMMENDED,
  NEW_NUMBER_CAP,
} from "@/shared/disparo/speed-safety";

describe("effectiveCap — per-number cap after the new-number clamp", () => {
  it("uses the slider value for an established number", () => {
    expect(effectiveCap(80, false)).toBe(80);
    expect(effectiveCap(150, false)).toBe(150);
  });

  it("clamps a new number below the slider even when the slider is high", () => {
    expect(effectiveCap(80, true)).toBe(NEW_NUMBER_CAP);
    expect(effectiveCap(200, true)).toBe(NEW_NUMBER_CAP);
  });

  it("never raises a new number above an already-low slider", () => {
    // slider below the new-number ceiling → keep the lower slider value
    expect(effectiveCap(10, true)).toBe(10);
  });
});

describe("capRisk — safe/risk zone from the recommended value", () => {
  it("is safe at and below the recommended cap", () => {
    expect(capRisk(80)).toBe("safe");
    expect(capRisk(50)).toBe("safe");
    expect(capRisk(CAP_RECOMMENDED)).toBe("safe");
  });

  it("is risk above the recommended cap", () => {
    expect(capRisk(81)).toBe("risk");
    expect(capRisk(200)).toBe("risk");
  });
});

describe("clampCap — slider bounds", () => {
  it("clamps below the floor and above the ceiling", () => {
    expect(clampCap(5)).toBe(CAP_MIN);
    expect(clampCap(999)).toBe(CAP_MAX);
    expect(clampCap(120)).toBe(120);
  });

  it("falls back to the recommended value for a non-finite input", () => {
    expect(clampCap(NaN)).toBe(CAP_RECOMMENDED);
  });
});
