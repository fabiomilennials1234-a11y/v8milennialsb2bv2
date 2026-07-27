import { describe, it, expect } from "vitest";
import {
  isTerminalRole,
  terminalKind,
  toFunnelRows,
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
    pipeType: "qualificacao",
    label: "Qualificação",
    color: "#6366f1",
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
  it("mapeia standard e aplica rótulo do display config (qualificacao→whatsapp)", () => {
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
