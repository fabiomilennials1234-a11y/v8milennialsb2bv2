// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createMockSupabase } from "../helpers/supabase-mock";
import { moveStage } from "../../supabase/functions/_shared/action-handlers/move-stage";

function makeInput(overrides: Record<string, unknown> = {}) {
  const { sb } = createMockSupabase();
  return {
    supabase: sb,
    organizationId: "org-1",
    leadId: "lead-1",
    conversationId: null,
    params: { target_stage: "agendado", target_pipe: "whatsapp" },
    ...overrides,
  };
}

describe("moveStage — shared action handler", () => {
  it("returns error when leadId is null", async () => {
    const result = await moveStage(makeInput({ leadId: null }));
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns error when target_stage is missing", async () => {
    const result = await moveStage(makeInput({ params: { target_pipe: "whatsapp" } }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("target_stage");
  });

  it("moves lead in whatsapp pipe — upserts pipeline_entries and updates leads.pipe_whatsapp", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("pipeline_stages", [
      { stage_key: "novo", organization_id: "org-1", pipeline_type: "whatsapp", is_active: true },
      { stage_key: "agendado", organization_id: "org-1", pipeline_type: "whatsapp", is_active: true },
    ]);
    mockTable("pipelines", [{ id: "pipe-wpp-id", organization_id: "org-1", slug: "whatsapp", type: "system" }]);
    mockTable("pipeline_entries", []);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: "agendado", target_pipe: "whatsapp" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.target_stage).toBe("agendado");
    expect(result.data?.target_pipe).toBe("whatsapp");
    const inserted = getInserted("pipeline_entries");
    expect(inserted.length).toBe(1);
    expect(inserted[0]).toMatchObject({ stage_key: "agendado", lead_id: "lead-1" });
  });

  it("moves lead in confirmacao pipe — upserts pipeline_entries only (no leads update)", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("pipeline_stages", [
      { stage_key: "marcada", organization_id: "org-1", pipeline_type: "confirmacao", is_active: true },
    ]);
    mockTable("pipelines", [{ id: "pipe-conf-id", organization_id: "org-1", slug: "confirmacao", type: "system" }]);
    mockTable("pipeline_entries", []);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: "marcada", target_pipe: "confirmacao" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.target_pipe).toBe("confirmacao");
    const inserted = getInserted("pipeline_entries");
    expect(inserted.length).toBe(1);
    expect(inserted[0]).toMatchObject({ stage_key: "marcada" });
  });

  it("moves lead in upsell_base pipe — updates upsell_clients.tipo_cliente_tempo", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("upsell_clients", [{ lead_id: "lead-1", tipo_cliente_tempo: "ativo" }]);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: "inativo", target_pipe: "upsell_base" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.target_pipe).toBe("upsell_base");
  });

  it("moves lead in upsell_gestao pipe — updates upsell_clients.gestao_stage", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("upsell_clients", [{ lead_id: "lead-1", gestao_stage: "onboarding" }]);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: "ativo", target_pipe: "upsell_gestao" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.target_pipe).toBe("upsell_gestao");
  });

  it("moves lead in campanha pipe — looks up stage by name and updates campanha_leads", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("campanha_stages", [{ id: "cs-1", name: "Engajado" }]);
    mockTable("campanha_leads", [{ lead_id: "lead-1", stage_id: "cs-0" }]);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: "engajado", target_pipe: "campanha" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.target_pipe).toBe("campanha");
  });

  it("moves lead in custom pipeline — validates stage and upserts custom_pipe_entries", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    const customPipeId = "custom-pipe-uuid";
    const stageId = "custom-stage-uuid";
    mockTable("custom_pipeline_stages", [{
      id: stageId, pipeline_id: customPipeId, organization_id: "org-1",
      is_final_positive: false, target_pipeline_id: null, target_stage_id: null,
      target_pipe_type: null, target_stage_key: null,
    }]);
    mockTable("custom_pipe_entries", []);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: stageId, target_pipe: customPipeId },
    });

    expect(result.success).toBe(true);
    expect(result.data?.target_pipe).toBe(customPipeId);
    const inserted = getInserted("custom_pipe_entries");
    expect(inserted.length).toBe(1);
    expect(inserted[0]).toMatchObject({ lead_id: "lead-1", pipeline_id: customPipeId, stage_id: stageId });
  });

  it("custom pipeline auto-transition — on is_final_positive, creates entry in target pipeline", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    const sourcePipeId = "source-pipe";
    const targetPipeId = "target-pipe";
    const sourceStageId = "source-stage-final";
    const targetStageId = "target-stage-initial";

    mockTable("custom_pipeline_stages", [{
      id: sourceStageId, pipeline_id: sourcePipeId, organization_id: "org-1",
      is_final_positive: true, target_pipeline_id: targetPipeId, target_stage_id: targetStageId,
      target_pipe_type: null, target_stage_key: null,
    }]);
    mockTable("custom_pipe_entries", []);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: sourceStageId, target_pipe: sourcePipeId },
    });

    expect(result.success).toBe(true);
    const entries = getInserted("custom_pipe_entries");
    // Should have 2 entries: source pipeline + auto-transition to target pipeline
    expect(entries.length).toBe(2);
    expect(entries[1]).toMatchObject({ pipeline_id: targetPipeId, stage_id: targetStageId });
  });

  it("rejects invalid stage for standard pipe", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipeline_stages", [
      { stage_key: "novo", organization_id: "org-1", pipeline_type: "whatsapp", is_active: true },
      { stage_key: "agendado", organization_id: "org-1", pipeline_type: "whatsapp", is_active: true },
    ]);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: "inexistente", target_pipe: "whatsapp" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("inválida");
  });

  it("returns error for custom pipeline with invalid stage ID", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("custom_pipeline_stages", []);
    mockTable("custom_pipe_entries", []);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: "nonexistent-stage", target_pipe: "some-uuid-pipeline" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("não encontrada");
  });
});
