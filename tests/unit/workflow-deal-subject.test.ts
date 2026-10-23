// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";
import { executeWorkflowAction } from "../../supabase/functions/_shared/workflow-action-handler";
import { __clearPipelineResolutionCache } from "../../supabase/functions/_shared/pipeline-adapter";
beforeEach(() => __clearPipelineResolutionCache());

const entry = { id: "entry-1", organization_id: "org-1", lead_id: "lead-1",
  pipeline_id: "pipe-1", deal_id: "deal-1", stage_key: "novo", stage_role: "open", closed_at: null };
const deal = { id: "deal-1", organization_id: "org-1", source_lead_id: "lead-1",
  outcome: "open", deleted_at: null };
function seed() {
  const mock = createMockSupabase();
  mock.mockTable("negocio_projetado", [entry]);
  mock.mockTable("pipeline_entries", [entry]);
  mock.mockTable("deals", [deal]);
  mock.mockTable("workflow_executions", [{ id: "exec-1", organization_id: "org-1", lead_id: "lead-1",
    pipeline_entry_id: null, deal_id: null }]);
  mock.mockTable("pipelines", [{ id: "pipe-2", organization_id: "org-1", slug: "lead_ruim", name: "Lead Ruim", type: "custom", is_active: true }]);
  mock.mockTable("pipeline_stages", [{ id: "stage-2", organization_id: "org-1", pipeline_id: "pipe-2", stage_key: "em_andamento", is_active: true }]);
  mock.mockRpc("mover_negocio", "entry-1");
  return mock;
}
function context(mock: ReturnType<typeof seed>, executionContext: Record<string, unknown> = {}) {
  return { supabase: mock.sb, organizationId: "org-1", leadId: "lead-1", executionId: "exec-1",
    nodeData: { actionType: "lose_deal", lossReason: "Não respondeu" }, executionContext };
}

describe("lead_created → perder negócio → mover etapa (Rafthel)", () => {
  it("vincula o sujeito antes da perda e move o mesmo card após perder", async () => {
    const mock = seed();
    const ctx = context(mock);
    const loss = await executeWorkflowAction(ctx);
    expect(loss.success).toBe(true);
    expect(mock.getUpdated("workflow_executions")[0]).toMatchObject({ pipeline_entry_id: "entry-1", deal_id: "deal-1" });
    expect(mock.getUpdated("deals")[0]).toMatchObject({ outcome: "lost", loss_reason: "Não respondeu" });
    // A projeção reflete o negócio fechado. Não deve haver outra busca por aberto.
    mock.mockTable("negocio_projetado", []);
    const moved = await executeWorkflowAction({ ...ctx, nodeData: {
      actionType: "move_stage", pipeType: "lead_ruim", targetStage: "em_andamento",
    } });
    expect(moved.success).toBe(true);
    expect(mock.getRpcCalls()).toContainEqual({ name: "mover_negocio", params: {
      p_entry_id: "entry-1", p_target_pipeline_id: "pipe-2", p_target_stage_key: "em_andamento",
      p_stage_origem: null, p_assigned_to: null,
    } });
    expect(mock.getInserted("pipeline_entries")).toHaveLength(0);
  });

  it("retoma após a perda sem gerar novo desfecho", async () => {
    const mock = seed();
    await executeWorkflowAction(context(mock));
    const persisted = mock.getUpdated("workflow_executions")[0];
    mock.mockTable("negocio_projetado", []);
    const result = await executeWorkflowAction({ ...context(mock, persisted.context as Record<string, unknown>),
      entryId: persisted.pipeline_entry_id as string, dealId: persisted.deal_id as string });
    expect(result.success).toBe(true);
    expect(result.data?.idempotent).toBe(true);
    expect(mock.getUpdated("deals")).toHaveLength(1);
  });

  it.each([0, 2, 50, 51])("não escolhe entre %i cards candidatos", async (count) => {
    const mock = seed();
    mock.mockTable("negocio_projetado", Array.from({ length: count }, (_, i) => ({ ...entry, id: `entry-${i}`, deal_id: null })));
    const result = await executeWorkflowAction(context(mock));
    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(mock.getUpdated("deals")).toHaveLength(0);
    expect(mock.getUpdated("workflow_executions")).toHaveLength(0);
  });

  it.each(["won", "lost"])("não escolhe negócio %s mesmo em etapa aberta", async (outcome) => {
    const mock = seed();
    mock.mockTable("deals", [{ ...deal, outcome }]);
    expect((await executeWorkflowAction(context(mock))).success).toBe(false);
    expect(mock.getUpdated("deals")).toHaveLength(0);
  });

  it.each(["negocio_projetado", "deals"])("falha de leitura em %s não vira ausência", async (table) => {
    const mock = seed();
    mock.mockSelectError(table, { code: "timeout", message: "temporário" });
    const result = await executeWorkflowAction(context(mock));
    expect(result).toMatchObject({ success: false, retryable: true });
    expect(mock.getUpdated("deals")).toHaveLength(0);
  });

  it("não encerra se não conseguir persistir o vínculo da execução", async () => {
    const mock = seed();
    mock.mockTable("workflow_executions", []);
    expect(await executeWorkflowAction(context(mock))).toMatchObject({ success: false, retryable: true });
    expect(mock.getUpdated("deals")).toHaveLength(0);
  });

  it("não sobrescreve um vínculo concorrente", async () => {
    const mock = seed();
    mock.mockTable("workflow_executions", [{ id: "exec-1", organization_id: "org-1", lead_id: "lead-1", pipeline_entry_id: "another" }]);
    expect((await executeWorkflowAction(context(mock))).success).toBe(false);
    expect(mock.getUpdated("deals")).toHaveLength(0);
  });

  it.each([{ organization_id: "other" }, { lead_id: "other" }, { closed_at: "2026-10-23" }, { stage_role: "won" }])(
    "não seleciona card incompatível: %j", async (patch) => {
      const mock = seed();
      mock.mockTable("negocio_projetado", [{ ...entry, ...patch }]);
      expect((await executeWorkflowAction(context(mock))).success).toBe(false);
      expect(mock.getUpdated("deals")).toHaveLength(0);
    },
  );

  it("materializa o negócio no card único sem identidade", async () => {
    const mock = seed();
    mock.mockTable("negocio_projetado", [{ ...entry, deal_id: null }]);
    mock.mockTable("pipeline_entries", [{ ...entry, deal_id: null }]);
    mock.mockRpc("garantir_negocio_da_entrada", "deal-1");
    expect((await executeWorkflowAction(context(mock))).success).toBe(true);
    expect(mock.getRpcCalls()).toContainEqual({ name: "garantir_negocio_da_entrada", params: { p_entry_id: "entry-1" } });
  });

  it("não desfaz um ganho decidido depois do vínculo inferido", async () => {
    const mock = seed();
    mock.mockTable("deals", [{ ...deal, outcome: "won" }]);
    const result = await executeWorkflowAction(context(mock, { pipeline_entry_id: "entry-1", deal_id: "deal-1", _closing_subject_inferred: true }));
    expect(result.success).toBe(false);
    expect(mock.getUpdated("deals")).toHaveLength(0);
  });

  it("não avança para mover etapa se outro escritor vencer a disputa do desfecho", async () => {
    const mock = seed();
    const originalFrom = mock.sb.from.bind(mock.sb);
    vi.spyOn(mock.sb, "from").mockImplementation((table: string) => {
      const chain = originalFrom(table);
      if (table === "deals") chain.update = () => {
        const refused = { eq: () => refused, is: () => refused, select: () => refused,
          maybeSingle: async () => ({ data: null, error: null }) };
        return refused;
      };
      return chain;
    });
    expect(await executeWorkflowAction(context(mock))).toMatchObject({ success: false, retryable: false });
  });

  it("aplica a mesma resolução segura para ganhar negócio", async () => {
    const mock = seed();
    expect((await executeWorkflowAction({ ...context(mock), nodeData: { actionType: "win_deal" } })).success).toBe(true);
    expect(mock.getUpdated("deals")[0]).toMatchObject({ outcome: "won" });
  });
});
