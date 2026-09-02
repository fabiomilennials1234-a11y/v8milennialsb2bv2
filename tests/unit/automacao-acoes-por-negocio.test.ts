/**
 * Fatia 3 — as ações de funil param de adivinhar qual Negócio.
 *
 * Duas coisas mudam, e as duas vêm do ADR-0023:
 *
 *   §1 — quem ocupa uma etapa é o Negócio. `move_stage` e a condição `stage`
 *        trabalhavam por `(lead, funil)` e escolhiam por `pickActiveEntry`
 *        ("o aberto, senão o mais recente"). Agora agem sobre o negócio que
 *        disparou a execução, quando ele é conhecido.
 *
 *   §4 — avançar é MOVE, não cópia. O caminho antigo criava um card novo no
 *        funil de destino e deixava o de origem para trás — é ele que fazia o
 *        mesmo lead aparecer em dois funis ao mesmo tempo. A tela já move pela
 *        RPC `mover_negocio`; a automação passa a usar a MESMA porta.
 *
 * Sem negócio declarado (gatilho da pessoa), tudo continua exatamente como era:
 * nenhum workflow que roda hoje muda de veredito por causa desta fatia.
 */
import { describe, it, expect } from "vitest";
import { moveStage } from "../../supabase/functions/_shared/action-handlers/move-stage";
import { evaluateCondition } from "../../supabase/functions/_shared/workflow-condition-evaluator";
import { applyChecklist } from "../../supabase/functions/_shared/action-handlers/checklist-operations";
import { createMockSupabase } from "../helpers/supabase-mock";

const ENTRY = "11111111-1111-4111-8111-111111111111";
const OUTRA_ENTRY = "22222222-2222-4222-8222-222222222222";
const PIPE_WA = "aaaaaaaa-0000-4000-8000-000000000001";
const PIPE_PROP = "aaaaaaaa-0000-4000-8000-000000000002";

/** Org própria por teste: `resolvePipelineId` guarda cache por `org:slug`. */
let n = 0;
function novaOrg() {
  n += 1;
  return `org-${n}`;
}

function cenario(org: string, over: { entryPipeline?: string } = {}) {
  const mock = createMockSupabase();
  mock.mockTable("pipelines", [
    { id: PIPE_WA, organization_id: org, slug: "whatsapp", type: "system" },
    { id: PIPE_PROP, organization_id: org, slug: "propostas", type: "system" },
  ]);
  mock.mockTable("pipeline_stages", [
    { organization_id: org, pipeline_type: "whatsapp", stage_key: "agendado", is_active: true },
    { organization_id: org, pipeline_type: "propostas", stage_key: "proposta_enviada", is_active: true },
  ]);
  mock.mockTable("pipeline_entries", [
    {
      id: ENTRY,
      organization_id: org,
      lead_id: "lead-1",
      pipeline_id: over.entryPipeline ?? PIPE_WA,
      stage_key: "abordado",
      closed_at: null,
      metadata: {},
    },
  ]);
  return mock;
}

function entrada(mock: ReturnType<typeof createMockSupabase>, org: string, entryId: string | null) {
  return {
    supabase: mock.sb,
    organizationId: org,
    leadId: "lead-1",
    entryId,
    dealId: null,
    conversationId: null,
    params: {},
  };
}

// ─── move_stage ─────────────────────────────────────────────────────────────

describe("move_stage — age sobre o Negócio que disparou", () => {
  it("mesmo funil: anda de etapa NO card que disparou, sem criar outro", async () => {
    const org = novaOrg();
    const mock = cenario(org);

    const r = await moveStage({
      ...entrada(mock, org, ENTRY),
      params: { target_pipe: "whatsapp", target_stage: "agendado" },
    });

    expect(r.success).toBe(true);
    expect(r.data?.entry_id).toBe(ENTRY);
    expect(r.data?.moved).toBe("stage");
    // Nada de card novo: o UPDATE é por id.
    expect(mock.getInserted("pipeline_entries")).toHaveLength(0);
    expect(mock.getUpdated("pipeline_entries")[0]).toMatchObject({ stage_key: "agendado" });
  });

  it("funil diferente: MOVE pela mesma RPC da tela, não copia (ADR-0023 §4)", async () => {
    const org = novaOrg();
    const mock = cenario(org);
    mock.mockRpc("mover_negocio", ENTRY);

    const r = await moveStage({
      ...entrada(mock, org, ENTRY),
      params: { target_pipe: "propostas", target_stage: "proposta_enviada" },
    });

    expect(r.success).toBe(true);
    expect(r.data?.moved).toBe("pipeline");
    const chamada = mock.getRpcCalls().find((c) => c.name === "mover_negocio");
    expect(chamada?.params).toMatchObject({
      p_entry_id: ENTRY,
      p_target_pipeline_id: PIPE_PROP,
      p_target_stage_key: "proposta_enviada",
    });
    // O card de origem NÃO fica para trás com um gêmeo novo.
    expect(mock.getInserted("pipeline_entries")).toHaveLength(0);
  });

  it("RPC recusando não vira sucesso silencioso", async () => {
    const org = novaOrg();
    const mock = cenario(org);
    // Sem `mockRpc`, o dublê devolve `{ data: null, error: 'RPC not mocked' }`
    // — que é o formato de uma recusa real (destino custom, outra org).
    const r = await moveStage({
      ...entrada(mock, org, ENTRY),
      params: { target_pipe: "propostas", target_stage: "proposta_enviada" },
    });

    expect(r.success).toBe(false);
    expect(r.error).toContain("mover_negocio");
    // Retentável: a etapa não foi escrita, e desistir aqui deixaria o negócio
    // parado sem ninguém saber.
    expect(r.retryable).toBe(true);
  });

  it("sem negócio declarado, o caminho de sempre — nenhum workflow muda hoje", async () => {
    const org = novaOrg();
    const mock = cenario(org);

    const r = await moveStage({
      ...entrada(mock, org, null),
      params: { target_pipe: "whatsapp", target_stage: "agendado" },
    });

    expect(r.success).toBe(true);
    // Caminho antigo: acha por (lead, funil) e faz UPDATE — sem `entry_id` na
    // resposta, que é a marca de que agiu pelo negócio.
    expect(r.data?.entry_id).toBeUndefined();
    expect(mock.getRpcCalls().find((c) => c.name === "mover_negocio")).toBeUndefined();
  });

  it("negócio de OUTRA org é ignorado — cai no caminho de sempre", async () => {
    const org = novaOrg();
    const mock = cenario(org);
    mock.mockTable("pipeline_entries", [
      {
        id: ENTRY,
        organization_id: "org-invasora",
        lead_id: "lead-1",
        pipeline_id: PIPE_WA,
        stage_key: "abordado",
        closed_at: null,
        metadata: {},
      },
    ]);

    const r = await moveStage({
      ...entrada(mock, org, ENTRY),
      params: { target_pipe: "whatsapp", target_stage: "agendado" },
    });

    expect(r.data?.entry_id).toBeUndefined();
  });

  it("negócio de OUTRO lead na mesma org também é ignorado", async () => {
    const org = novaOrg();
    const mock = cenario(org);
    mock.mockTable("pipeline_entries", [
      {
        id: ENTRY,
        organization_id: org,
        lead_id: "lead-outro",
        pipeline_id: PIPE_WA,
        stage_key: "abordado",
        closed_at: null,
        metadata: {},
      },
    ]);

    const r = await moveStage({
      ...entrada(mock, org, ENTRY),
      params: { target_pipe: "whatsapp", target_stage: "agendado" },
    });

    expect(r.data?.entry_id).toBeUndefined();
  });
});

// ─── condição `stage` ───────────────────────────────────────────────────────

describe("condição de etapa — lê o Negócio da execução, não o card de Oportunidades", () => {
  function comDoisCards(org: string) {
    const mock = createMockSupabase();
    mock.mockTable("leads", [{ id: "lead-1", organization_id: org, name: "Distética" }]);
    mock.mockTable("pipelines", [
      { id: PIPE_WA, organization_id: org, slug: "whatsapp", type: "system" },
      { id: PIPE_PROP, organization_id: org, slug: "propostas", type: "system" },
    ]);
    mock.mockTable("pipeline_entries", [
      { id: ENTRY, organization_id: org, lead_id: "lead-1", pipeline_id: PIPE_WA, stage_key: "abordado", closed_at: null },
      { id: OUTRA_ENTRY, organization_id: org, lead_id: "lead-1", pipeline_id: PIPE_PROP, stage_key: "proposta_enviada", closed_at: null },
    ]);
    return mock;
  }

  it("o negócio em Orçamentos responde pela SUA etapa", async () => {
    const org = novaOrg();
    const mock = comDoisCards(org);

    const ok = await evaluateCondition(
      mock.sb, "lead-1",
      { field: "stage", operator: "equals", value: "proposta_enviada" },
      OUTRA_ENTRY,
    );

    expect(ok).toBe(true);
  });

  it("e NÃO pela etapa do card de Oportunidades do mesmo lead", async () => {
    const org = novaOrg();
    const mock = comDoisCards(org);

    const ok = await evaluateCondition(
      mock.sb, "lead-1",
      { field: "stage", operator: "equals", value: "abordado" },
      OUTRA_ENTRY,
    );

    expect(ok).toBe(false);
  });

  it("sem negócio declarado, cai no negócio CORRENTE (ADR-0031: aberto > mais recente), não no card de Oportunidades", async () => {
    // SCRUM-627: o fallback deixou de ser o card de whatsapp chumbado. Com dois
    // negócios abertos, responde o que mexeu por último — aqui, o de Orçamentos.
    const org = novaOrg();
    const mock = comDoisCards(org);
    mock.mockTable("pipeline_entries", [
      { id: ENTRY, organization_id: org, lead_id: "lead-1", pipeline_id: PIPE_WA, stage_key: "abordado", closed_at: null, stage_changed_at: "2026-08-01T10:00:00Z", created_at: "2026-08-01T10:00:00Z" },
      { id: OUTRA_ENTRY, organization_id: org, lead_id: "lead-1", pipeline_id: PIPE_PROP, stage_key: "proposta_enviada", closed_at: null, stage_changed_at: "2026-08-20T10:00:00Z", created_at: "2026-08-20T10:00:00Z" },
    ]);

    const ok = await evaluateCondition(
      mock.sb, "lead-1",
      { field: "stage", operator: "equals", value: "proposta_enviada" },
      null,
    );

    expect(ok).toBe(true);
  });

  it("negócio de outra org não responde — cai no card de Oportunidades", async () => {
    const org = novaOrg();
    const mock = comDoisCards(org);
    mock.mockTable("pipeline_entries", [
      { id: ENTRY, organization_id: org, lead_id: "lead-1", pipeline_id: PIPE_WA, stage_key: "abordado", closed_at: null },
      { id: OUTRA_ENTRY, organization_id: "org-invasora", lead_id: "lead-1", pipeline_id: PIPE_PROP, stage_key: "proposta_enviada", closed_at: null },
    ]);

    const ok = await evaluateCondition(
      mock.sb, "lead-1",
      { field: "stage", operator: "equals", value: "abordado" },
      OUTRA_ENTRY,
    );

    expect(ok).toBe(true);
  });
});

// ─── apply_checklist ────────────────────────────────────────────────────────

describe("apply_checklist — o checklist é DO NEGÓCIO", () => {
  const TEMPLATE = "tpl-1";

  function comTemplate(org: string, jaAplicados: Record<string, unknown>[] = []) {
    const mock = createMockSupabase();
    mock.mockTable("checklists", [
      { id: TEMPLATE, organization_id: org, title: "Fechamento", description: null, lead_id: null },
      ...jaAplicados,
    ]);
    mock.mockTable("leads", [{ id: "lead-1", organization_id: org }]);
    mock.mockTable("checklist_items", [
      { id: "ti-1", checklist_id: TEMPLATE, title: "Enviar contrato", position: 0 },
    ]);
    return mock;
  }

  it("carimba o negócio que disparou", async () => {
    const org = novaOrg();
    const mock = comTemplate(org);

    const r = await applyChecklist({
      ...entrada(mock, org, ENTRY),
      params: { checklistTemplateId: TEMPLATE },
    });

    expect(r.success).toBe(true);
    const [criado] = mock.getInserted("checklists");
    expect(criado.pipeline_entry_id).toBe(ENTRY);
    // O lead continua gravado: o checklist é do Negócio E da pessoa por trás.
    expect(criado.lead_id).toBe("lead-1");
  });

  it("o SEGUNDO negócio do mesmo lead recebe o seu — era aqui que saía vazio", async () => {
    const org = novaOrg();
    // O primeiro negócio já tem o template aplicado.
    const mock = comTemplate(org, [
      {
        id: "cl-do-primeiro",
        organization_id: org,
        lead_id: "lead-1",
        source_template_id: TEMPLATE,
        pipeline_entry_id: ENTRY,
        title: "Fechamento",
      },
    ]);

    const r = await applyChecklist({
      ...entrada(mock, org, OUTRA_ENTRY),
      params: { checklistTemplateId: TEMPLATE },
    });

    expect(r.success).toBe(true);
    expect(r.data?.idempotent).toBeUndefined();
    expect(mock.getInserted("checklists")[0].pipeline_entry_id).toBe(OUTRA_ENTRY);
  });

  it("o MESMO negócio duas vezes continua sendo no-op", async () => {
    const org = novaOrg();
    const mock = comTemplate(org, [
      {
        id: "cl-ja",
        organization_id: org,
        lead_id: "lead-1",
        source_template_id: TEMPLATE,
        pipeline_entry_id: ENTRY,
        title: "Fechamento",
      },
    ]);

    const r = await applyChecklist({
      ...entrada(mock, org, ENTRY),
      params: { checklistTemplateId: TEMPLATE },
    });

    expect(r.data?.idempotent).toBe(true);
    expect(mock.getInserted("checklists")).toHaveLength(0);
  });

  it("gatilho da pessoa aplica NA PESSOA — sem negócio, sem carimbo", async () => {
    const org = novaOrg();
    const mock = comTemplate(org);

    const r = await applyChecklist({
      ...entrada(mock, org, null),
      params: { checklistTemplateId: TEMPLATE },
    });

    expect(r.success).toBe(true);
    expect(mock.getInserted("checklists")[0].pipeline_entry_id).toBeNull();
  });
});
