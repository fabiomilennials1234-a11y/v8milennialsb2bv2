import { it, expect, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn().mockResolvedValue({ data: "source-entry", error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc,
  from: () => { const q: Record<string, unknown> = {}; for (const k of ["select", "eq", "order", "limit"]) q[k] = () => q;
    q.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve); return q; },
} }));
import { upsertLeadIntoCustomPipe } from "@/modules/pipelines/lib/stageTransition";
it("transição da etapa ganha move a entrada de origem sem criar outro negócio", async () => {
  await upsertLeadIntoCustomPipe({ leadId: "lead", organizationId: "org", sourceEntryId: "source-entry", targetPipelineId: "target", targetStageId: "target-stage" } as Parameters<typeof upsertLeadIntoCustomPipe>[0]);
  expect(rpc).toHaveBeenCalledWith("mover_negocio", expect.objectContaining({ p_entry_id: "source-entry", p_target_pipeline_id: "target" }));
  expect(rpc.mock.calls.some(([name]) => name === "fn_entrada_custom_criar")).toBe(false);
});
