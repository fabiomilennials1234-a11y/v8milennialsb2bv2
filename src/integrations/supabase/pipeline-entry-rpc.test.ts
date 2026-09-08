import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("./client", () => ({
  supabase: { rpc },
}));

import {
  createCustomPipelineEntry,
  createSystemPipelineEntry,
  updateCustomPipelineEntry,
  updateSystemPipelineEntry,
} from "./pipeline-entry-rpc";

describe("pipeline entry RPC adapter", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: "entry-id", error: null });
  });

  it("preserva o shape legado completo e deriva o dono em propostas", async () => {
    await createSystemPipelineEntry({
      organizationId: "org",
      slug: "propostas",
      leadId: "lead",
      metadata: {
        responsible_id: null,
        closer_id: "closer",
        sale_value: 100,
      },
    });

    expect(rpc).toHaveBeenCalledWith("fn_entrada_sistema_criar", expect.objectContaining({
      p_organization_id: "org",
      p_slug: "propostas",
      p_lead_id: "lead",
      p_assigned_to: "closer",
      p_metadata: {
        sale_value: 100,
        closer_id: "closer",
        responsible_id: null,
        product_id: null,
        product_type: null,
        calor: null,
        loss_reason: null,
        loss_reason_id: null,
        commitment_date: null,
        contract_duration: null,
        metrics_period_at: null,
      },
    }));
  });

  it("mantém null explícito e remove apenas undefined do patch", async () => {
    await updateSystemPipelineEntry("entry", {
      assigned_to: null,
      stage_key: undefined,
      is_confirmed: false,
    });

    expect(rpc).toHaveBeenCalledWith("fn_entrada_sistema_atualizar", {
      p_entry_id: "entry",
      p_patch: { assigned_to: null, is_confirmed: false },
    });
  });

  it("traduz create e update custom sem escrever na view", async () => {
    await createCustomPipelineEntry({
      organizationId: "org",
      pipelineId: "pipeline",
      leadId: "lead",
      stageId: "stage",
      assignedTo: null,
    });
    await updateCustomPipelineEntry("entry", {
      stage_id: "next-stage",
      notes: undefined,
    });

    expect(rpc).toHaveBeenNthCalledWith(1, "fn_entrada_custom_criar", expect.objectContaining({
      p_organization_id: "org",
      p_pipeline_id: "pipeline",
      p_lead_id: "lead",
      p_stage_id: "stage",
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, "fn_entrada_custom_atualizar", {
      p_entry_id: "entry",
      p_patch: { stage_id: "next-stage" },
    });
  });
});
