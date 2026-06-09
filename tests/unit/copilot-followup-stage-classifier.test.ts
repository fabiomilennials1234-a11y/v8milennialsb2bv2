/**
 * TDD: Copilot Follow-up — AI Stage Classifier (deterministic core).
 *
 * Pure post-processing of the LLM's stage->role classification into per-org
 * trigger_stage_keys per Follow-up Situation (ADR-0006 amendment). The LLM call
 * and DB write are glue (edge fn); this is the deterministic part — including
 * the hard terminal override (won/lost stages never trigger anything).
 *
 * Import target: supabase/functions/_shared/copilot/followup-stage-classifier.ts
 */

import { describe, it, expect } from "vitest";
import "../helpers/deno-mock";

import {
  buildTriggerStageMap,
  type StageInfo,
} from "../../supabase/functions/_shared/copilot/followup-stage-classifier.ts";

function stage(partial: Partial<StageInfo> & { stageKey: string }): StageInfo {
  return {
    name: partial.stageKey,
    position: 0,
    isFinalPositive: false,
    isFinalNegative: false,
    ...partial,
  };
}

describe("buildTriggerStageMap", () => {
  // RED→GREEN 1 (tracer): a proposta_ativa stage lands in proposal_no_reply
  it("maps a proposta_ativa stage into proposal_no_reply", () => {
    const stages = [stage({ stageKey: "r2_fechamento", name: "Negociando" })];
    const classification = { r2_fechamento: "proposta_ativa" as const };

    const map = buildTriggerStageMap({ stages, classification });

    expect(map.proposal_no_reply).toEqual(["r2_fechamento"]);
  });

  // RED→GREEN 2 — hard terminal override: a won/lost stage never triggers,
  // even if the LLM misclassified it as proposta_ativa
  it("never includes a terminal (won/lost) stage, overriding the LLM", () => {
    const stages = [
      stage({ stageKey: "vendido", name: "Vendido", isFinalPositive: true }),
      stage({ stageKey: "perdido", name: "Perdido", isFinalNegative: true }),
    ];
    const classification = {
      vendido: "proposta_ativa" as const, // LLM wrong on purpose
      perdido: "proposta_ativa" as const,
    };

    const map = buildTriggerStageMap({ stages, classification });

    expect(map.proposal_no_reply ?? []).not.toContain("vendido");
    expect(map.proposal_no_reply ?? []).not.toContain("perdido");
  });

  // RED→GREEN 3 — a role with no Situation (frio) lands nowhere
  it("drops stages whose role maps to no Situation", () => {
    const stages = [stage({ stageKey: "esfriou", name: "Esfriou" })];
    const classification = { esfriou: "frio" as const };

    const map = buildTriggerStageMap({ stages, classification });

    expect(Object.keys(map)).toHaveLength(0);
  });

  // RED→GREEN 4 — multiple stages grouped by Situation (Milennials-shaped)
  it("groups multiple stages under their Situations", () => {
    const stages = [
      stage({ stageKey: "marcar_compromisso", name: "Proposta Gerada" }),
      stage({ stageKey: "r2_fechamento", name: "Negociando" }),
      stage({ stageKey: "vendido", name: "Vendido", isFinalPositive: true }),
    ];
    const classification = {
      marcar_compromisso: "proposta_ativa" as const,
      r2_fechamento: "proposta_ativa" as const,
      vendido: "ganho" as const,
    };

    const map = buildTriggerStageMap({ stages, classification });

    expect(map.proposal_no_reply).toEqual(["marcar_compromisso", "r2_fechamento"]);
  });
});
