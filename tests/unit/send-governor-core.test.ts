// @vitest-environment node
/**
 * Send Governor — pure decision core (anti-ban). Mirrors quiet-hours.test.ts:
 * the _shared module is imported directly and exercised with zero IO.
 *
 * Covers P1 per-number cap, P2 warm-up ramp, P3 quarantine state machine, P4
 * cold-contact gate, manual/system exemption, mode 'off', deriveCategory, and
 * the CRUCIAL shadow invariant: shadow NEVER emits a real block/defer.
 */

import { describe, it, expect } from "vitest";

const { evaluateSend, warmupCapForAge, deriveCategory, GOVERNOR_DEFAULT_CAP } =
  await import("../../supabase/functions/_shared/send-governor/core.ts");

type Ctx = import("../../supabase/functions/_shared/send-governor/types.ts").GovernorContext;
type State = import("../../supabase/functions/_shared/send-governor/types.ts").GovernorState;

const NOW = "2026-07-21T12:00:00.000Z";

function ctx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    orgId: "org-1",
    instanceId: "inst-1",
    category: "automation",
    recipientPhone: "5511999999999",
    ...overrides,
  };
}

function state(overrides: Partial<State> = {}): State {
  return {
    mode: "enforce",
    warmupEnabled: false,
    coldGateEnabled: false,
    usedToday: 0,
    instanceCap: 80,
    instanceAgeDays: 30,
    reputation: "healthy",
    quarantineUntil: null,
    isColdContact: false,
    nowIso: NOW,
    ...overrides,
  };
}

describe("warmupCapForAge — P2 ramp table", () => {
  it("follows the ramp with the default base cap (80)", () => {
    expect(warmupCapForAge(0, 80)).toBe(20);
    expect(warmupCapForAge(1, 80)).toBe(30);
    expect(warmupCapForAge(2, 80)).toBe(30);
    expect(warmupCapForAge(3, 80)).toBe(50);
    expect(warmupCapForAge(6, 80)).toBe(50);
    expect(warmupCapForAge(7, 80)).toBe(80);
    expect(warmupCapForAge(30, 80)).toBe(80);
  });

  it("never widens a tighter configured base cap", () => {
    expect(warmupCapForAge(0, 50)).toBe(20);
    expect(warmupCapForAge(3, 50)).toBe(50);
    expect(warmupCapForAge(6, 40)).toBe(40); // ramp 50 clamped to base 40
    expect(warmupCapForAge(7, 50)).toBe(50); // fully warmed → base cap
  });

  it("degrades to the base cap on unknown age (fail-open, never tightens)", () => {
    expect(warmupCapForAge(null, 80)).toBe(80);
    expect(warmupCapForAge(undefined, 80)).toBe(80);
    expect(warmupCapForAge(Number.NaN, 80)).toBe(80);
  });

  it("exposes the recommended default cap", () => {
    expect(GOVERNOR_DEFAULT_CAP).toBe(80);
  });
});

describe("deriveCategory", () => {
  it("defaults to automation (dispatch primitives never carry manual traffic)", () => {
    expect(deriveCategory(undefined)).toBe("automation");
    expect(deriveCategory(null)).toBe("automation");
    expect(deriveCategory("")).toBe("automation");
  });
  it("maps copilot sources to automation", () => {
    expect(deriveCategory("copilot")).toBe("automation");
    expect(deriveCategory("copilot_v2")).toBe("automation");
    expect(deriveCategory("followup")).toBe("automation");
  });
  it("maps blast/sender sources to mass", () => {
    expect(deriveCategory("mass")).toBe("mass");
    expect(deriveCategory("blast")).toBe("mass");
    expect(deriveCategory("sender")).toBe("mass");
    expect(deriveCategory("sender_advanced")).toBe("mass");
  });
  it("maps human + system sources", () => {
    expect(deriveCategory("manual")).toBe("manual");
    expect(deriveCategory("composer")).toBe("manual");
    expect(deriveCategory("system")).toBe("system");
    expect(deriveCategory("cron")).toBe("system");
  });
});

describe("mode 'off' — governor inert", () => {
  it("allows everything, even a quarantined over-cap send", () => {
    const d = evaluateSend(
      ctx(),
      state({ mode: "off", reputation: "quarantined", usedToday: 999 }),
    );
    expect(d.action).toBe("allow");
    expect(d.wouldBe).toBe("allow");
    expect(d.reason).toBe("governor_off");
    expect(d.shadowed).toBe(false);
  });
});

describe("manual exemption — always allowed", () => {
  for (const mode of ["off", "shadow", "enforce"] as const) {
    it(`allows a manual send in mode '${mode}' even quarantined + over cap`, () => {
      const d = evaluateSend(
        ctx({ category: "manual" }),
        state({ mode, reputation: "quarantined", usedToday: 999 }),
      );
      expect(d.action).toBe("allow");
      expect(d.reason).toBe(mode === "off" ? "governor_off" : "manual_exempt");
    });
  }
});

describe("system exemption (PR-0)", () => {
  it("allows system sends under enforce", () => {
    const d = evaluateSend(ctx({ category: "system" }), state({ usedToday: 999 }));
    expect(d.action).toBe("allow");
    expect(d.reason).toBe("allowed");
  });
});

describe("P3 quarantine state machine", () => {
  it("healthy → allow", () => {
    const d = evaluateSend(ctx(), state({ reputation: "healthy" }));
    expect(d.action).toBe("allow");
  });

  it("quarantined + unexpired → block (automation)", () => {
    const d = evaluateSend(
      ctx(),
      state({ reputation: "quarantined", quarantineUntil: "2026-07-21T14:00:00.000Z" }),
    );
    expect(d.action).toBe("block");
    expect(d.wouldBe).toBe("block");
    expect(d.reason).toBe("quarantined");
  });

  it("quarantined + unexpired → block (mass too)", () => {
    const d = evaluateSend(
      ctx({ category: "mass" }),
      state({ reputation: "quarantined", quarantineUntil: "2026-07-21T14:00:00.000Z" }),
    );
    expect(d.action).toBe("block");
    expect(d.reason).toBe("quarantined");
  });

  it("quarantined + EXPIRED → recovers (allow)", () => {
    const d = evaluateSend(
      ctx(),
      state({ reputation: "quarantined", quarantineUntil: "2026-07-21T10:00:00.000Z" }),
    );
    expect(d.action).toBe("allow");
    expect(d.reason).toBe("allowed");
  });

  it("quarantined indefinitely (null until) → block", () => {
    const d = evaluateSend(
      ctx(),
      state({ reputation: "quarantined", quarantineUntil: null }),
    );
    expect(d.action).toBe("block");
    expect(d.reason).toBe("quarantined");
  });
});

describe("P1 per-number cap + P2 warm-up", () => {
  it("allows under the cap", () => {
    const d = evaluateSend(ctx(), state({ usedToday: 79, instanceCap: 80 }));
    expect(d.action).toBe("allow");
  });

  it("defers at the cap", () => {
    const d = evaluateSend(ctx(), state({ usedToday: 80, instanceCap: 80 }));
    expect(d.action).toBe("defer");
    expect(d.reason).toBe("per_number_cap");
    expect(d.retryAt).toBeTruthy();
    expect(Date.parse(d.retryAt as string)).toBeGreaterThan(Date.parse(NOW));
  });

  it("warm-up tightens the cap on a young number", () => {
    // age 0 → warm-up cap 20; 20 used → defer even though base cap is 80.
    const d = evaluateSend(
      ctx(),
      state({ warmupEnabled: true, instanceAgeDays: 0, usedToday: 20, instanceCap: 80 }),
    );
    expect(d.action).toBe("defer");
    expect(d.reason).toBe("per_number_cap");
  });

  it("warm-up disabled uses the full base cap", () => {
    const d = evaluateSend(
      ctx(),
      state({ warmupEnabled: false, instanceAgeDays: 0, usedToday: 20, instanceCap: 80 }),
    );
    expect(d.action).toBe("allow");
  });

  it("mass ignores the per-number cap (only P3 applies to mass)", () => {
    const d = evaluateSend(ctx({ category: "mass" }), state({ usedToday: 999 }));
    expect(d.action).toBe("allow");
  });
});

describe("P4 cold-contact gate", () => {
  it("blocks a cold contact when the gate is enabled", () => {
    const d = evaluateSend(
      ctx(),
      state({ coldGateEnabled: true, isColdContact: true }),
    );
    expect(d.action).toBe("block");
    expect(d.reason).toBe("cold_contact");
  });

  it("allows a cold contact when the gate is disabled", () => {
    const d = evaluateSend(
      ctx(),
      state({ coldGateEnabled: false, isColdContact: true }),
    );
    expect(d.action).toBe("allow");
  });

  it("does not gate mass on coldness (mass = P3 only)", () => {
    const d = evaluateSend(
      ctx({ category: "mass" }),
      state({ coldGateEnabled: true, isColdContact: true }),
    );
    expect(d.action).toBe("allow");
  });
});

describe("SHADOW invariant — never a real block/defer", () => {
  const scenarios: Array<{ name: string; s: Partial<State>; c?: Partial<Ctx>; wouldBe: string; reason: string }> = [
    {
      name: "quarantine",
      s: { reputation: "quarantined", quarantineUntil: "2026-07-21T14:00:00.000Z" },
      wouldBe: "block",
      reason: "quarantined",
    },
    { name: "per-number cap", s: { usedToday: 80, instanceCap: 80 }, wouldBe: "defer", reason: "per_number_cap" },
    { name: "cold contact", s: { coldGateEnabled: true, isColdContact: true }, wouldBe: "block", reason: "cold_contact" },
  ];

  for (const sc of scenarios) {
    it(`shadow flips would-be ${sc.wouldBe} (${sc.name}) to allow, preserving wouldBe`, () => {
      const d = evaluateSend(ctx(sc.c), state({ mode: "shadow", ...sc.s }));
      expect(d.action).toBe("allow"); // NEVER blocks in shadow
      expect(d.wouldBe).toBe(sc.wouldBe);
      expect(d.reason).toBe(sc.reason);
      expect(d.shadowed).toBe(true);
    });

    it(`enforce actually applies ${sc.wouldBe} (${sc.name})`, () => {
      const d = evaluateSend(ctx(sc.c), state({ mode: "enforce", ...sc.s }));
      expect(d.action).toBe(sc.wouldBe);
      expect(d.shadowed).toBe(false);
    });
  }

  it("shadow allow stays a plain allow (nothing flipped)", () => {
    const d = evaluateSend(ctx(), state({ mode: "shadow" }));
    expect(d.action).toBe("allow");
    expect(d.wouldBe).toBe("allow");
    expect(d.shadowed).toBe(false);
  });
});
