/**
 * O sujeito da automação passa a incluir o Negócio (fatias 1 e 2).
 *
 * ── O QUE ESTAVA ERRADO ───────────────────────────────────────────────────
 * ADR-0023 §1: quem se move por um Pipeline é o Negócio; o Lead **nunca tem
 * etapa**. O motor de automação era a última superfície que ainda contrariava
 * isso — gatilho, execução e ação carregavam `lead_id` e mais nada. Os dois
 * gatilhos de etapa rodam EM CIMA da entrada do funil, têm `NEW.id` e
 * `NEW.deal_id` na mão, e jogavam os dois fora.
 *
 * Duas consequências medidas em produção (2026-08-25):
 *   1. toda ação de funil adivinhava de qual Negócio se tratava
 *      (`pickActiveEntry`: "o aberto, senão o mais recente"). 399 das 14.185
 *      execuções de 30 dias rodaram sobre leads com 2+ Negócios;
 *   2. o dedup era por `(workflow, lead)`: dois Negócios do mesmo Lead
 *      entrando na mesma etapa e o SEGUNDO era descartado como duplicata —
 *      sem erro, sem log. ADR-0023 §2 diz o oposto ("um Lead pode ter vários
 *      Negócios, inclusive dois abertos no mesmo funil"), então o motor
 *      proibia na prática o modelo que o produto já tinha decidido.
 */
import { describe, it, expect } from "vitest";
import { fireTrigger } from "../../supabase/functions/_shared/workflow-trigger";
import { createMockSupabase } from "../helpers/supabase-mock";

const ENTRY_A = "11111111-1111-4111-8111-111111111111";
const ENTRY_B = "22222222-2222-4222-8222-222222222222";
const DEAL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function comWorkflowDeEtapa() {
  const mock = createMockSupabase();
  mock.mockTable("workflows", [
    {
      id: "wf-1",
      trigger_config: { pipe_type: "whatsapp", to_stage: "agendado" },
      organization_id: "org-1",
      trigger_type: "stage_changed",
      is_active: true,
    },
  ]);
  mock.mockTable("workflow_executions", []);
  return mock;
}

const CONTEXTO_DE_ETAPA = {
  trigger: "stage_changed",
  pipe_type: "whatsapp",
  from_stage: "respondeu",
  to_stage: "agendado",
};

// ─── Fatia 1: o sujeito atravessa a cadeia ──────────────────────────────────

describe("fireTrigger — o Negócio chega até a execução", () => {
  it("lê o negócio de dentro do context (é por onde o gatilho de banco fala)", async () => {
    const { sb, mockTable: _m, getInserted } = comWorkflowDeEtapa();

    await fireTrigger({
      supabase: sb,
      organizationId: "org-1",
      triggerType: "stage_changed",
      leadId: "lead-1",
      context: { ...CONTEXTO_DE_ETAPA, pipeline_entry_id: ENTRY_A, deal_id: DEAL_A },
    });

    const [exec] = getInserted("workflow_executions");
    expect(exec.pipeline_entry_id).toBe(ENTRY_A);
    expect(exec.deal_id).toBe(DEAL_A);
    expect(exec.lead_id).toBe("lead-1");
  });

  it("aceita o negócio como parâmetro — o barramento de eventos não usa context", async () => {
    const { sb, getInserted } = comWorkflowDeEtapa();

    await fireTrigger({
      supabase: sb,
      organizationId: "org-1",
      triggerType: "stage_changed",
      leadId: "lead-1",
      entryId: ENTRY_A,
      dealId: DEAL_A,
      context: CONTEXTO_DE_ETAPA,
    });

    expect(getInserted("workflow_executions")[0].pipeline_entry_id).toBe(ENTRY_A);
  });

  it("o parâmetro explícito vence o context", async () => {
    const { sb, getInserted } = comWorkflowDeEtapa();

    await fireTrigger({
      supabase: sb,
      organizationId: "org-1",
      triggerType: "stage_changed",
      leadId: "lead-1",
      entryId: ENTRY_A,
      context: { ...CONTEXTO_DE_ETAPA, pipeline_entry_id: ENTRY_B },
    });

    expect(getInserted("workflow_executions")[0].pipeline_entry_id).toBe(ENTRY_A);
  });

  it("gatilho da PESSOA não inventa negócio — as colunas ficam nulas", async () => {
    const mock = createMockSupabase();
    mock.mockTable("workflows", [
      {
        id: "wf-2",
        trigger_config: {},
        organization_id: "org-1",
        trigger_type: "tag_added",
        is_active: true,
      },
    ]);
    mock.mockTable("workflow_executions", []);

    await fireTrigger({
      supabase: mock.sb,
      organizationId: "org-1",
      triggerType: "tag_added",
      leadId: "lead-1",
      context: { trigger: "tag_added", tag_name: "Ouro" },
    });

    const [exec] = mock.getInserted("workflow_executions");
    expect(exec.pipeline_entry_id).toBeNull();
    expect(exec.deal_id).toBeNull();
  });

  it('`null` em jsonb não vira o id de texto "null"', async () => {
    const { sb, getInserted } = comWorkflowDeEtapa();

    await fireTrigger({
      supabase: sb,
      organizationId: "org-1",
      triggerType: "stage_changed",
      leadId: "lead-1",
      // `jsonb_build_object('deal_id', NEW.deal_id)` com a coluna nula produz
      // exatamente isto — e um `"null"` viajando até um `.eq()` não casa com
      // nada e ainda mente no banco.
      context: { ...CONTEXTO_DE_ETAPA, pipeline_entry_id: ENTRY_A, deal_id: "null" },
    });

    const [exec] = getInserted("workflow_executions");
    expect(exec.pipeline_entry_id).toBe(ENTRY_A);
    expect(exec.deal_id).toBeNull();
  });
});

// ─── Fatia 2: o dedup passa a ser por Negócio ───────────────────────────────

describe("fireTrigger — dedup por Negócio, não por pessoa", () => {
  it("negócio DIFERENTE do mesmo lead dispara, mesmo com execução em voo", async () => {
    const mock = comWorkflowDeEtapa();
    // Já existe execução rodando para o negócio A, do MESMO lead.
    mock.mockTable("workflow_executions", [
      {
        id: "exec-a",
        workflow_id: "wf-1",
        lead_id: "lead-1",
        pipeline_entry_id: ENTRY_A,
        status: "running",
      },
    ]);

    const n = await fireTrigger({
      supabase: mock.sb,
      organizationId: "org-1",
      triggerType: "stage_changed",
      leadId: "lead-1",
      context: { ...CONTEXTO_DE_ETAPA, pipeline_entry_id: ENTRY_B },
    });

    expect(n).toBe(1);
    expect(mock.getInserted("workflow_executions")[0].pipeline_entry_id).toBe(ENTRY_B);
  });

  it("o MESMO negócio continua sendo protegido de redisparo", async () => {
    const mock = comWorkflowDeEtapa();
    mock.mockTable("workflow_executions", [
      {
        id: "exec-a",
        workflow_id: "wf-1",
        lead_id: "lead-1",
        pipeline_entry_id: ENTRY_A,
        status: "running",
      },
    ]);

    const n = await fireTrigger({
      supabase: mock.sb,
      organizationId: "org-1",
      triggerType: "stage_changed",
      leadId: "lead-1",
      context: { ...CONTEXTO_DE_ETAPA, pipeline_entry_id: ENTRY_A },
    });

    expect(n).toBe(0);
    expect(mock.getInserted("workflow_executions")).toHaveLength(0);
  });

  it("sem negócio declarado, o escopo continua sendo a pessoa", async () => {
    const mock = createMockSupabase();
    mock.mockTable("workflows", [
      {
        id: "wf-2",
        trigger_config: {},
        organization_id: "org-1",
        trigger_type: "tag_added",
        is_active: true,
      },
    ]);
    mock.mockTable("workflow_executions", [
      { id: "exec-x", workflow_id: "wf-2", lead_id: "lead-1", pipeline_entry_id: null, status: "running" },
    ]);

    const n = await fireTrigger({
      supabase: mock.sb,
      organizationId: "org-1",
      triggerType: "tag_added",
      leadId: "lead-1",
      context: { trigger: "tag_added" },
    });

    expect(n).toBe(0);
  });

  it("a chave de dedup separa dois negócios do mesmo lead na MESMA etapa", async () => {
    const chaves: unknown[] = [];
    for (const entry of [ENTRY_A, ENTRY_B]) {
      const mock = comWorkflowDeEtapa();
      await fireTrigger({
        supabase: mock.sb,
        organizationId: "org-1",
        triggerType: "stage_changed",
        leadId: "lead-1",
        context: { ...CONTEXTO_DE_ETAPA, pipeline_entry_id: entry },
      });
      chaves.push(mock.getInserted("workflow_executions")[0].trigger_dedup_key);
    }

    // O índice único é `(workflow_id, lead_id, trigger_dedup_key)`. Chaves
    // iguais = o segundo card é comido pelo `ignoreDuplicates`, que era
    // exatamente o defeito.
    expect(chaves[0]).toBeTruthy();
    expect(chaves[0]).not.toBe(chaves[1]);
  });

  it("o MESMO negócio, na mesma janela, mantém a chave estável", async () => {
    const chaves: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      const mock = comWorkflowDeEtapa();
      await fireTrigger({
        supabase: mock.sb,
        organizationId: "org-1",
        triggerType: "stage_changed",
        leadId: "lead-1",
        context: { ...CONTEXTO_DE_ETAPA, pipeline_entry_id: ENTRY_A },
      });
      chaves.push(mock.getInserted("workflow_executions")[0].trigger_dedup_key);
    }
    expect(chaves[0]).toBe(chaves[1]);
  });
});
