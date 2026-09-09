/**
 * Fatia 5 — o vocabulário do Negócio no editor de automações.
 *
 * Antes disto a categoria "Negócios" tinha UM gatilho (`deal_created`) e UMA
 * ação (`create_deal`), e nenhum dos 130 workflows ativos usava nenhum dos
 * dois. "Quando ganhar o negócio, faça X" não era desenhável.
 *
 * ── GANHAR E PERDER NÃO SÃO CAMPOS ────────────────────────────────────────
 * ADR-0023 §4/§5: a posição mora no card e encerrar é chegar na etapa terminal.
 * Por isso `deal_won`/`deal_lost` são DERIVADOS de `stage_changed` pelo papel da
 * etapa de destino, e não gatilhos em `deals.won` — medido em prod
 * (2026-08-25): 34.662 dos 34.980 negócios têm `won = false` porque o backfill
 * carimbou assim tudo que não estava ganho. A coluna responde "não foi ganho",
 * não "foi perdido".
 */
import { describe, it, expect } from "vitest";
import { fireTrigger } from "../../supabase/functions/_shared/workflow-trigger";
import {
  winDeal,
  loseDeal,
  setDealValue,
  setDealOwner,
} from "../../supabase/functions/_shared/action-handlers/deal-operations";
import { evaluateCondition } from "../../supabase/functions/_shared/workflow-condition-evaluator";
import { createMockSupabase } from "../helpers/supabase-mock";

const ENTRY = "11111111-1111-4111-8111-111111111111";
const DEAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PIPE = "bbbbbbbb-0000-4000-8000-000000000001";

function entrada(mock: ReturnType<typeof createMockSupabase>, over: Record<string, unknown> = {}) {
  return {
    supabase: mock.sb,
    organizationId: "org-1",
    leadId: "lead-1",
    entryId: ENTRY,
    dealId: DEAL,
    conversationId: null,
    params: {},
    ...over,
  };
}

function funilCompleto() {
  const mock = createMockSupabase();
  mock.mockTable("pipelines", [{ id: PIPE, organization_id: "org-1", slug: "propostas", type: "system" }]);
  mock.mockTable("pipeline_stages", [
    { organization_id: "org-1", pipeline_type: "propostas", stage_key: "enviada", stage_role: "open", is_active: true, position: 0 },
    { organization_id: "org-1", pipeline_type: "propostas", stage_key: "vendido", stage_role: "won", is_active: true, position: 1 },
    { organization_id: "org-1", pipeline_type: "propostas", stage_key: "perdido", stage_role: "lost", is_active: true, position: 2 },
  ]);
  mock.mockTable("pipeline_entries", [
    { id: ENTRY, organization_id: "org-1", lead_id: "lead-1", pipeline_id: PIPE, stage_key: "enviada", deal_id: DEAL, closed_at: null },
  ]);
  mock.mockTable("deals", [{ id: DEAL, organization_id: "org-1", value: 1000, won: null, outcome: "open" }]);
  return mock;
}

// ─── Gatilhos derivados ─────────────────────────────────────────────────────

describe("deal_won / deal_lost — derivados do papel da etapa", () => {
  function comWorkflow(triggerType: string) {
    const mock = funilCompleto();
    mock.mockTable("workflows", [
      { id: "wf-1", trigger_config: {}, organization_id: "org-1", trigger_type: triggerType, is_active: true },
    ]);
    mock.mockTable("workflow_executions", []);
    return mock;
  }

  const ctx = (toStage: string) => ({
    trigger: "stage_changed",
    pipe_type: "propostas",
    from_stage: "enviada",
    to_stage: toStage,
    pipeline_entry_id: ENTRY,
    deal_id: DEAL,
  });

  it("chegar na etapa de ganho dispara o workflow de Negócio Ganho", async () => {
    const mock = comWorkflow("deal_won");

    await fireTrigger({
      supabase: mock.sb,
      organizationId: "org-1",
      triggerType: "stage_changed",
      leadId: "lead-1",
      context: ctx("vendido"),
    });

    const execs = mock.getInserted("workflow_executions");
    expect(execs).toHaveLength(1);
    expect(execs[0].workflow_id).toBe("wf-1");
    // O sujeito viaja: as ações do fluxo agem sobre ESTE negócio.
    expect(execs[0].pipeline_entry_id).toBe(ENTRY);
    expect(execs[0].deal_id).toBe(DEAL);
  });

  it("etapa de perda dispara Negócio Perdido, não Ganho", async () => {
    const ganho = comWorkflow("deal_won");
    await fireTrigger({
      supabase: ganho.sb, organizationId: "org-1", triggerType: "stage_changed",
      leadId: "lead-1", context: ctx("perdido"),
    });
    expect(ganho.getInserted("workflow_executions")).toHaveLength(0);

    const perda = comWorkflow("deal_lost");
    await fireTrigger({
      supabase: perda.sb, organizationId: "org-1", triggerType: "stage_changed",
      leadId: "lead-1", context: ctx("perdido"),
    });
    expect(perda.getInserted("workflow_executions")).toHaveLength(1);
  });

  it("etapa comum não deriva nada", async () => {
    const mock = comWorkflow("deal_won");
    await fireTrigger({
      supabase: mock.sb, organizationId: "org-1", triggerType: "stage_changed",
      leadId: "lead-1", context: ctx("enviada"),
    });
    expect(mock.getInserted("workflow_executions")).toHaveLength(0);
  });

  it("dispara mesmo sem NENHUM workflow de stage_changed — é a razão de derivar antes do corpo", async () => {
    // Só existe workflow de `deal_won`. O corpo do `fireTrigger` sai cedo
    // ("nenhum workflow casou") e, se a derivação morasse no fim, o negócio
    // ganho não avisaria ninguém.
    const mock = comWorkflow("deal_won");
    await fireTrigger({
      supabase: mock.sb, organizationId: "org-1", triggerType: "stage_changed",
      leadId: "lead-1", context: ctx("vendido"),
    });
    expect(mock.getInserted("workflow_executions")).toHaveLength(1);
  });
});

// ─── Ações ──────────────────────────────────────────────────────────────────

describe("win_deal / lose_deal — desfecho é do negócio, não da etapa", () => {
  // ADR-0023 Emenda 1 (2026-08-28). Este bloco AFIRMAVA o contrário —
  // "encerrar é mover" — e estava certo enquanto o desfecho fosse derivado da
  // etapa. Deixou de estar: `deals.outcome` é a fonte e o card não se move.
  //
  // Os casos não foram apagados nem pulados: o comportamento continua
  // existindo, mudou. Cada um passou a afirmar o que a ação faz hoje.

  it("ganhar marca o negócio e NÃO move o card", async () => {
    const mock = funilCompleto();
    const r = await winDeal(entrada(mock));

    expect(r.success).toBe(true);
    expect(r.data?.outcome).toBe("won");
    expect(r.data?.moved).toBe(false);
    // O card fica na etapa `enviada` — é isto que permite ganhar em qualquer
    // etapa, e o que destrava os 283 funis (71%) sem etapa `won`.
    expect(mock.getUpdated("pipeline_entries")).toHaveLength(0);
    expect(mock.getUpdated("deals")[0]).toMatchObject({
      outcome: "won", outcome_source: "workflow",
    });
  });

  it("perder marca o desfecho e grava o motivo", async () => {
    const mock = funilCompleto();
    const r = await loseDeal(entrada(mock, { params: { lossReason: "Preço" } }));

    expect(r.data?.outcome).toBe("lost");
    expect(mock.getUpdated("deals")[0]).toMatchObject({
      outcome: "lost", loss_reason: "Preço",
    });
    expect(mock.getUpdated("pipeline_entries")).toHaveLength(0);
  });

  it("sem entrada MAS com negócio na execução, encerra — o sujeito é o negócio", async () => {
    // Mudou de sentido junto com a feature. Antes, sem `entryId` não havia como
    // achar a etapa terminal e a ação recusava. Agora o desfecho é do negócio:
    // se a execução carrega `dealId`, há o que encerrar.
    const mock = funilCompleto();
    const r = await winDeal(entrada(mock, { entryId: null }));

    expect(r.success).toBe(true);
    expect(mock.getUpdated("deals")[0]).toMatchObject({ outcome: "won" });
  });

  it("sem entrada E sem negócio, RECUSA — fechar a venda errada é o erro mais caro", async () => {
    const mock = funilCompleto();
    const r = await winDeal(entrada(mock, { entryId: null, dealId: null }));

    expect(r.success).toBe(false);
    expect(r.retryable).toBe(false);
    expect(r.error).toMatch(/gatilho de funil/);
    expect(mock.getUpdated("deals")).toHaveLength(0);
  });

  it("🔴 funil SEM etapa terminal agora funciona — era a falha em 71% dos funis", async () => {
    // O caso anterior afirmava o oposto: "falha explícito — 83 funis custom
    // estão assim". Hoje são 283 de 396 (71%), e essa falha era a razão desta
    // mudança existir. A ausência de etapa `won` deixou de importar: o
    // desfecho não precisa de etapa nenhuma.
    const mock = funilCompleto();
    mock.mockTable("pipeline_stages", [
      { organization_id: "org-1", pipeline_type: "propostas", stage_key: "enviada", stage_role: "open", is_active: true, position: 0 },
    ]);

    const r = await winDeal(entrada(mock));
    expect(r.success).toBe(true);
    expect(mock.getUpdated("deals")[0]).toMatchObject({ outcome: "won" });
  });

  it("🔴 negócio já ganho é no-op — o caderno de vendas é append-only", async () => {
    const mock = funilCompleto();
    mock.mockTable("deals", [{ id: DEAL, organization_id: "org-1", value: 1000, won: true, outcome: "won" }]);

    const r = await winDeal(entrada(mock));
    expect(r.data?.idempotent).toBe(true);
    // Zero escrita. Um UPDATE aqui dispararia a transição de `outcome`, que é
    // o que grava em `sale_events` — e uma venda duplicada não se apaga.
    expect(mock.getUpdated("deals")).toHaveLength(0);
    expect(mock.getUpdated("pipeline_entries")).toHaveLength(0);
  });
});

describe("set_deal_value / set_deal_owner", () => {
  it("grava o valor no negócio", async () => {
    const mock = funilCompleto();
    const r = await setDealValue(entrada(mock, { params: { dealValue: "2500" } }));

    expect(r.success).toBe(true);
    expect(mock.getUpdated("deals")[0]).toMatchObject({ value: 2500 });
  });

  it("valor inválido não vira zero em silêncio", async () => {
    const mock = funilCompleto();
    const r = await setDealValue(entrada(mock, { params: { dealValue: "abc" } }));

    expect(r.success).toBe(false);
    expect(mock.getUpdated("deals")).toHaveLength(0);
  });

  it("negócio sem registro em `deals` recusa valor em vez de inventar onde guardar", async () => {
    const mock = funilCompleto();
    const r = await setDealValue(entrada(mock, { dealId: null, params: { dealValue: "10" } }));

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/exige `deals`/);
  });

  it("o dono é escrito nos DOIS lugares — board e relatório não podem discordar", async () => {
    const mock = funilCompleto();
    mock.mockTable("team_members", [{ id: "tm-1", organization_id: "org-1", is_active: true }]);

    const r = await setDealOwner(entrada(mock, { params: { dealOwnerId: "tm-1" } }));

    expect(r.success).toBe(true);
    expect(mock.getUpdated("pipeline_entries")[0]).toMatchObject({ assigned_to: "tm-1" });
    expect(mock.getUpdated("deals")[0]).toMatchObject({ owner_id: "tm-1" });
  });

  it("membro de outra org é recusado", async () => {
    const mock = funilCompleto();
    mock.mockTable("team_members", [{ id: "tm-1", organization_id: "org-invasora", is_active: true }]);

    const r = await setDealOwner(entrada(mock, { params: { dealOwnerId: "tm-1" } }));
    expect(r.success).toBe(false);
    expect(mock.getUpdated("deals")).toHaveLength(0);
  });
});

// ─── Condições ──────────────────────────────────────────────────────────────

describe("condições do Negócio", () => {
  function comLead(mock: ReturnType<typeof createMockSupabase>) {
    mock.mockTable("leads", [{ id: "lead-1", organization_id: "org-1" }]);
    return mock;
  }

  it("`deal_value` compara o valor do NEGÓCIO", async () => {
    const mock = comLead(funilCompleto());

    expect(await evaluateCondition(mock.sb, "lead-1", { field: "deal_value", operator: "greater_than", value: "500" }, ENTRY)).toBe(true);
    expect(await evaluateCondition(mock.sb, "lead-1", { field: "deal_value", operator: "greater_than", value: "5000" }, ENTRY)).toBe(false);
  });

  it("`has_open_deal` responde pela existência de card aberto", async () => {
    const mock = comLead(funilCompleto());
    expect(await evaluateCondition(mock.sb, "lead-1", { field: "has_open_deal", operator: "equals", value: "true" }, ENTRY)).toBe(true);
  });

  it("`days_in_stage` mede a partir de `stage_changed_at`, não de `updated_at`", async () => {
    const mock = comLead(funilCompleto());
    const dezDiasAtras = new Date(Date.now() - 10 * 86_400_000).toISOString();
    mock.mockTable("pipeline_entries", [
      {
        id: ENTRY, organization_id: "org-1", lead_id: "lead-1", pipeline_id: PIPE,
        stage_key: "enviada", deal_id: DEAL, closed_at: null,
        stage_changed_at: dezDiasAtras,
        // Editado agora — uma nota nova não pode zerar a estagnação.
        updated_at: new Date().toISOString(),
      },
    ]);

    expect(await evaluateCondition(mock.sb, "lead-1", { field: "days_in_stage", operator: "greater_or_equal", value: "10" }, ENTRY)).toBe(true);
  });
});
