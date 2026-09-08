import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("./client", () => ({
  supabase: { rpc },
}));

import {
  createCustomPipelineStage,
  createCustomPipelineWithStages,
  updateCustomPipelineRecord,
  updateCustomPipelineStage,
} from "./custom-pipeline-rpc";

describe("custom pipeline RPC adapter", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: "generated-id", error: null });
  });

  it("manda funil e etapas numa única RPC e remove undefined", async () => {
    await createCustomPipelineWithStages(
      { name: "Funil", description: undefined, is_active: true },
      [{ name: "Entrada", color: undefined, position: 0 }],
    );

    expect(rpc).toHaveBeenCalledWith("criar_funil_custom_com_etapas", {
      p_funil: { name: "Funil", is_active: true },
      p_etapas: [{ name: "Entrada", position: 0 }],
    });
  });

  it("usa as portas compartilhadas para criar e atualizar etapa", async () => {
    await createCustomPipelineStage({ pipeline_id: "pipeline", name: "Entrada" });
    await updateCustomPipelineStage("stage", { color: null, name: undefined });

    expect(rpc).toHaveBeenNthCalledWith(1, "fn_etapa_custom_criar", {
      p_input: { pipeline_id: "pipeline", name: "Entrada" },
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "fn_etapa_custom_atualizar", {
      p_id: "stage",
      p_patch: { color: null },
    });
  });

  it("atualiza funil pelo id e preserva null explícito", async () => {
    await updateCustomPipelineRecord("pipeline", { status: "paused", ends_at: null });

    expect(rpc).toHaveBeenCalledWith("fn_funil_custom_atualizar", {
      p_id: "pipeline",
      p_patch: { status: "paused", ends_at: null },
    });
  });
});
