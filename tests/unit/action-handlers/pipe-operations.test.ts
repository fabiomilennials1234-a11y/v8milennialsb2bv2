// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { createMockSupabase } from "../../helpers/supabase-mock";
import {
  duplicateToPipe,
  markAsLost,
  removeFromPipe,
} from "../../../supabase/functions/_shared/action-handlers/pipe-operations";
import { __clearPipelineResolutionCache } from "../../../supabase/functions/_shared/pipeline-adapter";
import type { ActionInput } from "../../../supabase/functions/_shared/action-handlers/types";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEAD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FUNNEL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const INITIAL_STAGE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LOST_STAGE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function input(
  supabase: ActionInput["supabase"],
  params: Record<string, unknown>,
  leadId: string | null = LEAD,
): ActionInput {
  return {
    supabase,
    organizationId: ORG,
    leadId,
    entryId: null,
    dealId: null,
    conversationId: null,
    params,
  };
}

function seedFunnel(mockTable: ReturnType<typeof createMockSupabase>["mockTable"]) {
  mockTable("pipelines", [{
    id: FUNNEL,
    organization_id: ORG,
    slug: "black-friday",
    name: "Black Friday",
    type: "custom",
    is_active: true,
  }]);
  mockTable("pipeline_stages", [
    {
      id: INITIAL_STAGE,
      organization_id: ORG,
      pipeline_id: FUNNEL,
      stage_key: "novo",
      stage_role: "open",
      is_final_negative: false,
      is_active: true,
      position: 0,
    },
    {
      id: LOST_STAGE,
      organization_id: ORG,
      pipeline_id: FUNNEL,
      stage_key: "sem-interesse",
      stage_role: "lost",
      is_final_negative: true,
      is_active: true,
      position: 9,
    },
  ]);
}

beforeEach(() => __clearPipelineResolutionCache());

describe("duplicateToPipe", () => {
  it("recusa lead ausente", async () => {
    const { sb } = createMockSupabase();
    expect((await duplicateToPipe(input(sb, { pipelineId: FUNNEL, targetStage: INITIAL_STAGE }, null))).success).toBe(false);
  });

  it("exige funil e etapa, sem defaults escondidos", async () => {
    const { sb } = createMockSupabase();
    expect((await duplicateToPipe(input(sb, {}))).error).toBe("No target funnel configured");
    expect((await duplicateToPipe(input(sb, { pipelineId: FUNNEL }))).error).toBe("No target stage configured");
  });

  it("adiciona em funil criado pela org e converte UUID da etapa em stage_key", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    seedFunnel(mockTable);
    mockTable("leads", [{ id: LEAD, organization_id: ORG }]);
    mockTable("pipeline_entries", []);

    const result = await duplicateToPipe(input(sb, {
      pipelineId: FUNNEL,
      targetStage: INITIAL_STAGE,
    }));

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ pipelineId: FUNNEL, targetStage: "novo" });
    expect(getInserted("pipeline_entries")[0]).toMatchObject({
      organization_id: ORG,
      lead_id: LEAD,
      pipeline_id: FUNNEL,
      stage_key: "novo",
    });
  });

  it("mantém leitura de slug e stage_key dos nós antigos", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedFunnel(mockTable);
    mockTable("leads", [{ id: LEAD, organization_id: ORG }]);
    mockTable("pipeline_entries", []);

    const result = await duplicateToPipe(input(sb, {
      targetPipeType: "black-friday",
      targetPipeStage: "novo",
    }));
    expect(result.success).toBe(true);
  });

  it("não reporta sucesso para funil inexistente", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: LEAD, organization_id: ORG }]);
    mockTable("pipelines", []);

    const result = await duplicateToPipe(input(sb, {
      targetPipeType: "nao-existe",
      targetPipeStage: "novo",
    }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("pipeline_not_found");
  });

  it("não encontra lead de outra organização", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedFunnel(mockTable);
    mockTable("leads", [{ id: LEAD, organization_id: "outra-org" }]);
    expect((await duplicateToPipe(input(sb, { pipelineId: FUNNEL, targetStage: INITIAL_STAGE }))).error).toBe("Lead not found");
  });
});

describe("removeFromPipe", () => {
  it("exige lead e funil", async () => {
    const { sb } = createMockSupabase();
    expect((await removeFromPipe(input(sb, { pipelineId: FUNNEL }, null))).success).toBe(false);
    expect((await removeFromPipe(input(sb, {}))).error).toBe("No funnel configured");
  });

  it("remove de qualquer funil por UUID", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedFunnel(mockTable);
    mockTable("pipeline_entries", [{ id: "entry-1", lead_id: LEAD, pipeline_id: FUNNEL }]);

    const result = await removeFromPipe(input(sb, { pipelineId: FUNNEL }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ pipelineId: FUNNEL });
  });

  it("não reporta sucesso para funil inexistente", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipelines", []);
    expect((await removeFromPipe(input(sb, { pipeType: "sumiu" }))).success).toBe(false);
  });
});

describe("markAsLost", () => {
  it("exige lead e funil", async () => {
    const { sb } = createMockSupabase();
    expect((await markAsLost(input(sb, { pipelineId: FUNNEL }, null))).success).toBe(false);
    expect((await markAsLost(input(sb, {}))).error).toBe("No funnel configured");
  });

  it("usa a etapa semântica lost do funil e registra o motivo", async () => {
    const { sb, mockTable, getInserted, getUpdated } = createMockSupabase();
    seedFunnel(mockTable);
    mockTable("pipeline_entries", [{
      id: "entry-1",
      organization_id: ORG,
      lead_id: LEAD,
      pipeline_id: FUNNEL,
      stage_key: "novo",
      metadata: {},
      closed_at: null,
      stage_changed_at: "2026-01-01",
      created_at: "2026-01-01",
    }]);

    const result = await markAsLost(input(sb, {
      pipelineId: FUNNEL,
      lostReason: "Sem orçamento",
    }));

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ pipelineId: FUNNEL, targetStage: "sem-interesse" });
    expect(getUpdated("pipeline_entries").at(-1)).toMatchObject({
      stage_key: "sem-interesse",
      metadata: { loss_reason: "Sem orçamento", loss_reason_id: "Sem orçamento" },
    });
    expect(getInserted("lead_history")[0]).toMatchObject({
      lead_id: LEAD,
      organization_id: ORG,
      action: "marked_lost",
      metadata: { pipelineId: FUNNEL },
    });
  });

  it("falha quando o funil não possui etapa de perda", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedFunnel(mockTable);
    mockTable("pipeline_stages", [{
      id: INITIAL_STAGE,
      organization_id: ORG,
      pipeline_id: FUNNEL,
      stage_key: "novo",
      stage_role: "open",
      is_final_negative: false,
      is_active: true,
      position: 0,
    }]);
    expect((await markAsLost(input(sb, { pipelineId: FUNNEL }))).error).toBe("No lost stage configured for funnel");
  });

  it("falha quando o lead não possui negócio no funil", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedFunnel(mockTable);
    mockTable("pipeline_entries", []);
    expect((await markAsLost(input(sb, { pipelineId: FUNNEL }))).success).toBe(false);
  });
});
