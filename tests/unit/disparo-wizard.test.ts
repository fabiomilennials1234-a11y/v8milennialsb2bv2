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
  { id: "a", label: "Comercial", cap: 80, selected: true, regime: "chip" },
  { id: "b", label: "Suporte", cap: 40, selected: false, regime: "chip" },
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
  // Ordem revista em #1722: o número (e com ele o REGIME) passou a vir antes do
  // conteúdo, porque é o regime que decide o que o conteúdo pode ser. Os seis
  // passos e os seis rótulos são os mesmos.
  it("has the six canonical Wizard Linear steps in order (Velocidade before Mensagem)", () => {
    expect(DISPARO_STEPS.map((s) => s.id)).toEqual([
      "audience",
      "speed",
      "message",
      "postsend",
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
    s = wizardReducer(s, { type: "NEXT" }); // audience → speed
    s = wizardReducer(s, { type: "NEXT" }); // speed → message
    s = wizardReducer(s, { type: "NEXT" }); // message → postsend
    expect(DISPARO_STEPS[s.index].id).toBe("postsend");
    expect(canAdvance(s)).toBe(true);
    s = wizardReducer(s, { type: "NEXT" }); // postsend → review (sem interação)
    expect(DISPARO_STEPS[s.index].id).toBe("review");
  });

  it("move mode without a stage blocks NEXT on postsend", () => {
    let s = createInitialState("2026-06-25", NUMBERS);
    s = wizardReducer(s, { type: "PATCH", patch: { audienceCount: 10, message: "Olá" } });
    s = wizardReducer(s, { type: "NEXT" });
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

// ── Regime misto na seleção de números (#1722) ──────────────────────────────

describe("validateStep('speed') — regime misto", () => {
  it("recusa Chip e Canal Oficial selecionados juntos, com motivo legível", () => {
    // Um Disparo tem UM conteúdo. Chip manda texto livre e Canal Oficial manda
    // Template aprovado (ADR-0028 §1) — selecionar os dois pediria duas
    // mensagens diferentes no mesmo Disparo. A recusa acontece aqui, no passo
    // que escolhe os números, e não no envio: o operador descobre antes de
    // congelar a audiência, não pela linha falhada de outra pessoa.
    const draft = freshDraft({
      numbers: [
        { id: "carol", label: "Carol", cap: 80, selected: true, regime: "chip" },
        { id: "chique", label: "Chiquê", cap: 80, selected: true, regime: "oficial" },
      ],
    });

    const v = validateStep("speed", draft);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/regime|Canal Oficial/i);
  });

  it("aceita dois números do MESMO regime", () => {
    // CONTROLE POSITIVO: a recusa acima é do regime misto, não de "mais de um
    // número" — multi-número é o comportamento de hoje e continua valendo.
    const draft = freshDraft({
      numbers: [
        { id: "a", label: "A", cap: 80, selected: true, regime: "chip" },
        { id: "b", label: "B", cap: 40, selected: true, regime: "chip" },
      ],
    });
    expect(validateStep("speed", draft).ok).toBe(true);
  });
});

// ── Número e regime ANTES do conteúdo (#1722, decisão do CTO) ───────────────

describe("ordem dos passos", () => {
  it("o número é escolhido antes de a mensagem ser escrita", () => {
    // Sem isto, o critério 3 é impossível: "escolher o número oficial troca o
    // passo de conteúdo" não pode valer se o conteúdo vem primeiro. E é a única
    // ordem em que a tela nunca pede uma decisão que o passo seguinte anula —
    // no desenho anterior, trocar o número no passo 4 invalidaria a mensagem
    // escrita no passo 2, e quem pagaria seria o operador.
    const ids = DISPARO_STEPS.map((s) => s.id);
    expect(ids.indexOf("speed")).toBeLessThan(ids.indexOf("message"));
  });

  it("os passos continuam sendo os mesmos seis, com os mesmos rótulos", () => {
    // Critério 8: a Organization só com Chip vê os MESMOS campos, na MESMA
    // linguagem. O que muda é a posição de uma tela — nada mais.
    expect(DISPARO_STEPS.map((s) => s.label).sort()).toEqual(
      ["Acompanhar", "Destino", "Mensagem", "Pra quem", "Revisão", "Velocidade"],
    );
  });
});

describe("validateStep('message') — o regime decide o que é conteúdo válido", () => {
  const oficial = (over: Partial<DisparoDraft> = {}) =>
    freshDraft({
      numbers: [{ id: "chique", label: "Chiquê", cap: 80, selected: true, regime: "oficial" }],
      ...over,
    });

  it("Canal Oficial sem Template escolhido não avança", () => {
    // Fora da janela de 24h a Meta só aceita Template aprovado (ADR-0028 §1).
    // Texto livre aqui seria uma recusa do fornecedor descoberta no envio, em
    // massa, depois de a audiência já estar congelada.
    const v = validateStep("message", oficial({ message: "oi tudo bem" }));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/Template/i);
  });

  it("Canal Oficial com Template escolhido avança, mesmo sem texto livre", () => {
    const v = validateStep(
      "message",
      oficial({
        message: "",
        template: { name: "boas_vindas", language: "pt_BR", components: [], previewText: "Olá!", buttonLabels: [] },
      }),
    );
    expect(v.ok).toBe(true);
  });

  it("Chip continua exigindo texto e nada mais — comportamento idêntico ao de hoje", () => {
    // CONTROLE do critério 8: a regra nova não pode ter encostado no Chip.
    expect(validateStep("message", freshDraft({ message: "" })).ok).toBe(false);
    expect(validateStep("message", freshDraft({ message: "Olá!" })).ok).toBe(true);
  });
});
