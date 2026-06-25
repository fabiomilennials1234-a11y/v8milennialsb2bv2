/**
 * Disparos Wizard Linear — pure state machine (#904).
 *
 * Covers gating (can't skip an incomplete step), back/forward navigation,
 * progress-bar jumps bounded by the furthest reached step, draft patching,
 * and the RELEASE → monitor transition.
 */
import { describe, it, expect } from "vitest";
import {
  createInitialState,
  wizardReducer,
  validateStep,
  canAdvance,
  selectedDailyCapacity,
  DISPARO_STEPS,
  LAST_STEP_INDEX,
  type DisparoDraft,
  type DisparoNumber,
} from "@/modules/campaigns/components/disparo-wizard/wizard-machine";

const NUMBERS: DisparoNumber[] = [
  { id: "a", label: "Comercial", cap: 80, selected: true },
  { id: "b", label: "Suporte", cap: 40, selected: false },
];

function freshDraft(over: Partial<DisparoDraft> = {}): DisparoDraft {
  return {
    audienceId: null,
    audienceLabel: "",
    audienceCount: 0,
    message: "",
    media: null,
    mediaError: null,
    numbers: NUMBERS,
    startDateIso: "2026-06-25",
    released: false,
    ...over,
  };
}

describe("steps", () => {
  it("has the five canonical Wizard Linear steps in order", () => {
    expect(DISPARO_STEPS.map((s) => s.id)).toEqual([
      "audience",
      "message",
      "speed",
      "review",
      "monitor",
    ]);
    expect(LAST_STEP_INDEX).toBe(4);
  });
});

describe("validateStep", () => {
  it("audience requires a frozen count > 0", () => {
    expect(validateStep("audience", freshDraft()).ok).toBe(false);
    expect(validateStep("audience", freshDraft({ audienceCount: 1240 })).ok).toBe(true);
  });

  it("message requires non-empty text and no media error", () => {
    expect(validateStep("message", freshDraft({ message: "   " })).ok).toBe(false);
    expect(validateStep("message", freshDraft({ message: "Olá" })).ok).toBe(true);
    const withErr = freshDraft({ message: "Olá", mediaError: "Arquivo muito grande — máximo 5 MB." });
    expect(validateStep("message", withErr).ok).toBe(false);
    expect(validateStep("message", withErr).reason).toContain("máximo");
  });

  it("speed requires at least one selected number with capacity", () => {
    expect(validateStep("speed", freshDraft({ numbers: NUMBERS.map((n) => ({ ...n, selected: false })) })).ok).toBe(false);
    expect(validateStep("speed", freshDraft()).ok).toBe(true);
  });

  it("review and monitor are always passable", () => {
    expect(validateStep("review", freshDraft()).ok).toBe(true);
    expect(validateStep("monitor", freshDraft()).ok).toBe(true);
  });
});

describe("selectedDailyCapacity", () => {
  it("sums only selected numbers' caps", () => {
    expect(selectedDailyCapacity(freshDraft())).toBe(80);
    expect(selectedDailyCapacity(freshDraft({ numbers: NUMBERS.map((n) => ({ ...n, selected: true })) }))).toBe(120);
  });
});

describe("navigation gating", () => {
  it("blocks NEXT from an incomplete step", () => {
    const s0 = createInitialState("2026-06-25", NUMBERS);
    expect(canAdvance(s0)).toBe(false);
    expect(wizardReducer(s0, { type: "NEXT" })).toBe(s0); // unchanged
  });

  it("advances once the current step is valid and tracks furthest", () => {
    let s = createInitialState("2026-06-25", NUMBERS);
    s = wizardReducer(s, { type: "PATCH", patch: { audienceCount: 500, audienceLabel: "Estágio Novo" } });
    expect(canAdvance(s)).toBe(true);
    s = wizardReducer(s, { type: "NEXT" });
    expect(s.index).toBe(1);
    expect(s.furthest).toBe(1);
  });

  it("BACK never goes below zero", () => {
    const s0 = createInitialState("2026-06-25", NUMBERS);
    expect(wizardReducer(s0, { type: "BACK" }).index).toBe(0);
  });

  it("GOTO jumps back freely but is clamped to the furthest reached", () => {
    let s = createInitialState("2026-06-25", NUMBERS);
    s = wizardReducer(s, { type: "PATCH", patch: { audienceCount: 10 } });
    s = wizardReducer(s, { type: "NEXT" }); // index 1, furthest 1
    // Forward jump beyond furthest is clamped.
    expect(wizardReducer(s, { type: "GOTO", index: 4 }).index).toBe(1);
    // Back jump is allowed.
    expect(wizardReducer(s, { type: "GOTO", index: 0 }).index).toBe(0);
  });
});

describe("RELEASE", () => {
  it("flips released and lands on the monitor step", () => {
    let s = createInitialState("2026-06-25", NUMBERS);
    s = wizardReducer(s, { type: "RELEASE" });
    expect(s.draft.released).toBe(true);
    expect(s.index).toBe(LAST_STEP_INDEX);
    expect(s.furthest).toBe(LAST_STEP_INDEX);
  });
});
