import { describe, it, expect } from "vitest";
import {
  isTerminalRole,
  terminalKind,
  toFunnelRows,
  availableFunnelsToAdd,
  type FunnelCardRow,
} from "./contextPanelFunnelHelpers";
import type { PipelineStatus } from "@/modules/leads";

describe("isTerminalRole / terminalKind", () => {
  it("won e lost são terminais", () => {
    expect(isTerminalRole("won")).toBe(true);
    expect(isTerminalRole("lost")).toBe(true);
    expect(terminalKind("won")).toBe("won");
    expect(terminalKind("lost")).toBe("lost");
  });
  it("open/meeting/null não são terminais", () => {
    expect(isTerminalRole("open")).toBe(false);
    expect(isTerminalRole("meeting_booked")).toBe(false);
    expect(isTerminalRole(null)).toBe(false);
    expect(isTerminalRole(undefined)).toBe(false);
    expect(terminalKind("open")).toBeNull();
  });
});

const standard = (over: Partial<Extract<PipelineStatus, { type: "standard" }>> = {}): PipelineStatus =>
  ({
    type: "standard",
    pipeType: "whatsapp",
    label: "Qualificação",
    color: "#6366f1",
    pipelineDbId: "pl-opp",
    pipeId: "entry-1",
    currentStage: "novo",
    currentStageLabel: "Novo",
    stages: [
      { id: "novo", label: "Novo", color: "#aaa", role: "open" },
      { id: "ganho", label: "Ganho", color: "#0f0", role: "won" },
    ],
    ...over,
  }) as PipelineStatus;

describe("toFunnelRows", () => {
  it("mapeia standard e aplica rótulo do display config", () => {
    const rows = toFunnelRows([standard()], [
      { pipe_type: "whatsapp", display_name: "Oportunidades" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Oportunidades");
    expect(rows[0].entryId).toBe("entry-1");
    expect(rows[0].currentStageKey).toBe("novo");
    expect(rows[0].stages.find((s) => s.key === "ganho")?.role).toBe("won");
  });

  it("sem display config, cai no label do próprio pipeline", () => {
    const rows = toFunnelRows([standard()], []);
    expect(rows[0].label).toBe("Qualificação");
  });

  it("pula funil sem entry (pipeId null)", () => {
    const rows = toFunnelRows([standard({ pipeId: null })]);
    expect(rows).toHaveLength(0);
  });

  it("exclui upsell/Carteira (pipelineDbId null) mesmo com pipeId — é tabela legacy", () => {
    const upsell = standard({ pipeType: "upsell", pipeId: "upsell-legacy-id", pipelineDbId: null });
    expect(toFunnelRows([upsell])).toHaveLength(0);
  });

  it("mapeia custom pipeline pelo entryId + nome próprio", () => {
    const custom = {
      type: "custom",
      pipelineId: "cp-1",
      pipelineName: "Pós-venda",
      pipelineColor: "#38bdf8",
      pipelineIcon: "star",
      entryId: "centry-9",
      currentStageId: "s1",
      currentStageName: "Ativo",
      stages: [{ id: "s1", name: "Ativo", color: "#38bdf8", position: 0, role: "open" }],
    } as PipelineStatus;
    const rows: FunnelCardRow[] = toFunnelRows([custom]);
    expect(rows[0].label).toBe("Pós-venda");
    expect(rows[0].entryId).toBe("centry-9");
    expect(rows[0].stages[0].key).toBe("s1");
  });
});

describe("availableFunnelsToAdd", () => {
  it("lista só funis sem entry, com pipeline_id + primeira etapa", () => {
    const notIn = standard({ pipeId: null, pipelineDbId: "pl-orc", label: "Orçamentos" });
    const alreadyIn = standard({ pipeId: "e1", pipelineDbId: "pl-opp" });
    const rows = availableFunnelsToAdd([notIn, alreadyIn], [
      { pipe_type: "whatsapp", display_name: "Oportunidades" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].pipelineId).toBe("pl-orc");
    expect(rows[0].firstStageKey).toBe("novo");
  });

  it("exclui upsell (pipelineDbId null) e funil sem etapas", () => {
    const upsell = standard({ pipeType: "upsell", pipeId: null, pipelineDbId: null });
    const noStages = standard({ pipeId: null, pipelineDbId: "pl-x", stages: [] });
    expect(availableFunnelsToAdd([upsell, noStages])).toHaveLength(0);
  });

  it("custom sem entry entra pelo próprio nome", () => {
    const custom = {
      type: "custom",
      pipelineId: "cp-2",
      pipelineName: "Reativação",
      pipelineColor: "#fb7185",
      pipelineIcon: "star",
      entryId: null,
      currentStageId: null,
      currentStageName: null,
      stages: [{ id: "start", name: "Início", color: "#fb7185", position: 0, role: "open" }],
    } as PipelineStatus;
    const rows = availableFunnelsToAdd([custom]);
    expect(rows[0].pipelineId).toBe("cp-2");
    expect(rows[0].label).toBe("Reativação");
    expect(rows[0].firstStageKey).toBe("start");
  });

  // Café Jurerê, 2026-09-30: lead com "Vendido" (fechado) em ENVASE - NEGOCIAÇÃO
  // não conseguia abrir a recompra ali — o funil sumia de "Adicionar a".
  const envase = (over: Record<string, unknown> = {}) =>
    ({
      type: "custom",
      pipelineId: "cp-envase",
      pipelineName: "ENVASE - NEGOCIAÇÃO EM ANDAMENTO",
      pipelineColor: "#f97316",
      pipelineIcon: "star",
      entryId: "deal-1",
      closedAt: null,
      currentStageId: "s1",
      currentStageName: "Cliente em Atendimento",
      stages: [{ id: "s1", name: "Cliente em Atendimento", color: "#f97316", position: 0, role: "open" }],
      ...over,
    }) as PipelineStatus;

  it("funil onde o negócio já fechou volta a ser oferecido (recompra)", () => {
    const rows = availableFunnelsToAdd([envase({ closedAt: "2026-09-01T00:00:00Z" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].pipelineId).toBe("cp-envase");
    expect(rows[0].firstStageId).toBe("s1");
  });

  it("negócio aberto tranca o funil, mesmo havendo outro fechado nele", () => {
    const rows = availableFunnelsToAdd([
      envase({ entryId: "deal-velho", closedAt: "2026-01-01T00:00:00Z" }),
      envase({ entryId: "deal-novo", closedAt: null }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it("dois negócios fechados no mesmo funil viram UMA opção", () => {
    const rows = availableFunnelsToAdd([
      envase({ entryId: "a", closedAt: "2026-01-01T00:00:00Z" }),
      envase({ entryId: "b", closedAt: "2026-05-01T00:00:00Z" }),
    ]);
    expect(rows).toHaveLength(1);
  });

  it("linha com negócio sem closedAt conhecido é tratada como aberta", () => {
    const semCampo = envase();
    delete (semCampo as { closedAt?: unknown }).closedAt;
    expect(availableFunnelsToAdd([semCampo])).toHaveLength(0);
  });
});

describe("toFunnelRows — N negócios no mesmo funil", () => {
  it("cada negócio tem chave própria (não colide no React)", () => {
    const base = {
      type: "custom",
      pipelineId: "cp-1",
      pipelineName: "Envase",
      pipelineColor: "#f97316",
      pipelineIcon: "star",
      currentStageId: "s1",
      currentStageName: "Ativo",
      stages: [{ id: "s1", name: "Ativo", color: "#f97316", position: 0, role: "open" }],
    };
    const rows = toFunnelRows([
      { ...base, entryId: "a", closedAt: "2026-01-01T00:00:00Z" } as PipelineStatus,
      { ...base, entryId: "b", closedAt: null } as PipelineStatus,
    ]);
    expect(rows.map((r) => r.key)).toEqual(["a", "b"]);
  });
});
