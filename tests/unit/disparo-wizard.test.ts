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
import { createDefaultSelection } from "@/modules/campaigns/components/disparo-wizard/audience-resolve";

const NUMBERS: DisparoNumber[] = [
  { id: "a", label: "Comercial", cap: 80, selected: true },
  { id: "b", label: "Suporte", cap: 40, selected: false },
];

function freshDraft(over: Partial<DisparoDraft> = {}): DisparoDraft {
  return {
    audienceSourceType: "estagio",
    audience: createDefaultSelection(),
    audienceLabel: "",
    audienceCount: 0,
    leadIds: [],
    audienceSource: null,
    message: "",
    media: null,
    mediaError: null,
    antiBan: true,
    postSendMode: "none",
    postSendFunnelKind: "system",
    postSendPipelineType: null,
    postSendPipelineId: null,
    postSendStageKey: "",
    postSendLabel: "",
    numbers: NUMBERS,
    capPerNumber: 80,
    startDateIso: "2026-06-25",
    released: false,
    ...over,
  };
}

describe("steps", () => {
  it("has the six canonical Wizard Linear steps in order (Destino between Mensagem and Velocidade)", () => {
    expect(DISPARO_STEPS.map((s) => s.id)).toEqual([
      "audience",
      "message",
      "postsend",
      "speed",
      "review",
      "monitor",
    ]);
    expect(LAST_STEP_INDEX).toBe(5);
  });

  it("labels the postsend step 'Destino'", () => {
    expect(DISPARO_STEPS.find((s) => s.id === "postsend")?.label).toBe("Destino");
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

  it("postsend passes untouched (default 'none' — optional step)", () => {
    expect(validateStep("postsend", freshDraft()).ok).toBe(true);
  });

  it("postsend in move mode requires a destination stage", () => {
    const noStage = validateStep("postsend", freshDraft({ postSendMode: "move" }));
    expect(noStage.ok).toBe(false);
    expect(noStage.reason).toBe("Escolha a etapa de destino.");

    const withStage = validateStep(
      "postsend",
      freshDraft({
        postSendMode: "move",
        postSendPipelineType: "propostas",
        postSendStageKey: "enviada",
        postSendLabel: "Orçamentos · Enviada",
      }),
    );
    expect(withStage.ok).toBe(true);
    expect(withStage.reason).toBeNull();
  });
});

describe("postsend defaults", () => {
  it("createInitialState starts with no post-send move and no destination", () => {
    const s = createInitialState("2026-06-25", NUMBERS);
    expect(s.draft.postSendMode).toBe("none");
    expect(s.draft.postSendFunnelKind).toBe("system");
    expect(s.draft.postSendPipelineType).toBeNull();
    expect(s.draft.postSendPipelineId).toBeNull();
    expect(s.draft.postSendStageKey).toBe("");
    expect(s.draft.postSendLabel).toBe("");
  });

  it("default draft advances through postsend without interaction", () => {
    let s = createInitialState("2026-06-25", NUMBERS);
    s = wizardReducer(s, { type: "PATCH", patch: { audienceCount: 10, message: "Olá" } });
    s = wizardReducer(s, { type: "NEXT" }); // audience → message
    s = wizardReducer(s, { type: "NEXT" }); // message → postsend
    expect(DISPARO_STEPS[s.index].id).toBe("postsend");
    expect(canAdvance(s)).toBe(true);
    s = wizardReducer(s, { type: "NEXT" }); // postsend → speed (no interaction)
    expect(DISPARO_STEPS[s.index].id).toBe("speed");
  });

  it("move mode without a stage blocks NEXT on postsend", () => {
    let s = createInitialState("2026-06-25", NUMBERS);
    s = wizardReducer(s, { type: "PATCH", patch: { audienceCount: 10, message: "Olá" } });
    s = wizardReducer(s, { type: "NEXT" });
    s = wizardReducer(s, { type: "NEXT" }); // on postsend
    s = wizardReducer(s, { type: "PATCH", patch: { postSendMode: "move" } });
    expect(canAdvance(s)).toBe(false);
    expect(wizardReducer(s, { type: "NEXT" })).toBe(s); // unchanged
    s = wizardReducer(s, {
      type: "PATCH",
      patch: { postSendStageKey: "novo_lead", postSendLabel: "Oportunidades · Novo lead" },
    });
    expect(canAdvance(s)).toBe(true);
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
