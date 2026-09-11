import { beforeEach, expect, it, vi } from "vitest";
const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from } }));
import { upsertLeadIntoCustomPipe } from "@/modules/pipelines/lib/stageTransition";
const params = { sourceEntryId: "source", sourceStageKey: "won", leadId: "lead", organizationId: "org", targetPipelineId: "target", targetStageId: "target-stage" };
beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: "source", error: null }); });
it("passa pela etapa de ganho e transfere a mesma entrada numa única chamada", async () => {
  await upsertLeadIntoCustomPipe(params);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("mover_negocio", {
    p_entry_id: "source", p_target_pipeline_id: "target", p_target_stage_key: "target-stage", p_stage_origem: "won", p_assigned_to: null,
  });
});
it("não procura nem sobrescreve outra venda do lead no destino", async () => {
  await upsertLeadIntoCustomPipe(params);
  expect(from).not.toHaveBeenCalled();
});
it("propaga falha do movimento sem tentar criar negócio", async () => {
  rpc.mockResolvedValue({ error: new Error("Destino inválido") });
  await expect(upsertLeadIntoCustomPipe(params)).rejects.toThrow("Destino inválido");
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("recusa transição sem negócio de origem", async () => {
  await expect(upsertLeadIntoCustomPipe({ ...params, sourceEntryId: "" })).rejects.toThrow("origem");
  expect(rpc).not.toHaveBeenCalled();
});
