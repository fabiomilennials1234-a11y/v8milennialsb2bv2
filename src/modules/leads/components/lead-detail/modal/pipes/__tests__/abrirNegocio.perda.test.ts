import { describe, expect, it, vi } from "vitest";

/**
 * Q1 — "Novo negócio" não nasce em etapa de perda: as opções marcam `isLoss`,
 * o default pula a perda, e o caminho programático recusa.
 */

const h = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: h.toastError, success: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { buildNewDealOptions } from "../newDealOptions";
import { etapaInicial } from "../../../../../lib/etapa-de-perda";
import { etapaDeAbertura } from "../useAbrirNegocio";
import type { PipelineStatus } from "../../../../../hooks/useLeadAllPipelines";

const STAGES = [
  { id: "st-perda", name: "Perdido", color: "#f00", position: 0, role: "open", isFinalNegative: true },
  { id: "st-lost", name: "Perdido 2", color: "#f00", position: 1, role: "lost", isFinalNegative: false },
  { id: "st-aberto", name: "Aberto", color: "#0f0", position: 2, role: "open", isFinalNegative: false },
];

const custom = {
  type: "custom",
  pipelineId: "pipe-1",
  pipelineName: "Mustang",
  pipelineColor: "#333",
  entryId: null,
  closedAt: null,
  currentStageId: null,
  stages: STAGES,
} as unknown as PipelineStatus;

describe("buildNewDealOptions + etapaInicial", () => {
  it("marca as etapas de perda e o default cai na primeira não-perda", () => {
    const [opcao] = buildNewDealOptions([custom], { canAdd: { allowed: true }, vendaFechada: false });
    expect(opcao.stages.map((s) => [s.id, s.isLoss])).toEqual([
      ["st-perda", true],
      ["st-lost", true],
      ["st-aberto", false],
    ]);
    expect(etapaInicial(opcao)).toBe("st-aberto");
  });

  it("todas de perda: sem default", () => {
    expect(etapaInicial({ stages: [{ id: "x", isLoss: true }] })).toBe("");
    expect(etapaInicial(null)).toBe("");
  });
});

describe("etapaDeAbertura — guarda do caminho programático", () => {
  it("sem escolha: primeira não-perda", () => {
    expect(etapaDeAbertura(STAGES, undefined)).toBe("st-aberto");
  });

  it("escolha de etapa de perda é recusada com aviso", () => {
    expect(() => etapaDeAbertura(STAGES, "st-lost")).toThrow("etapa_de_perda_na_abertura");
    expect(h.toastError).toHaveBeenCalled();
  });

  it("escolha aberta passa", () => {
    expect(etapaDeAbertura(STAGES, "st-aberto")).toBe("st-aberto");
  });

  it("funil só com perda: recusa", () => {
    expect(() => etapaDeAbertura(STAGES.slice(0, 2), null)).toThrow("funil_sem_etapa_de_entrada");
  });
});
