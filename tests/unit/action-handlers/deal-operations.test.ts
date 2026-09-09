// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createMockSupabase } from "../../helpers/supabase-mock";
import { createDeal, winDeal, loseDeal } from "../../../supabase/functions/_shared/action-handlers/deal-operations";

const LEAD = {
  id: "lead-1",
  organization_id: "org-1",
  name: "Acme",
  company: "Acme Ltda",
  responsible_id: "tm-1",
  sale_responsible_id: null,
  closer_id: null,
  pre_sale_responsible_id: null,
  sdr_id: null,
};

function seed() {
  const mock = createMockSupabase();
  mock.mockTable("leads", [LEAD]);
  mock.mockTable("deals", []);
  return mock;
}

describe("createDeal — shared action handler", () => {
  it("rejects execution without lead", async () => {
    const { sb } = seed();
    const result = await createDeal({
      supabase: sb, organizationId: "org-1", leadId: null,
      conversationId: null, params: {},
    });
    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
  });

  it("creates the deal linked to the lead and exposes deal_id", async () => {
    const { sb, getInserted } = seed();
    const result = await createDeal({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      conversationId: null,
      params: {
        dealTitleTemplate: "Negócio — Acme",
        dealValue: 1500,
        dealProbability: 70,
        _executionId: "exec-9",
      },
    });

    expect(result.success).toBe(true);
    const inserted = getInserted("deals")[0] as Record<string, unknown>;
    expect(inserted.source_lead_id).toBe("lead-1");
    expect(inserted.organization_id).toBe("org-1");
    expect(inserted.title).toBe("Negócio — Acme");
    expect(inserted.value).toBe(1500);
    expect(inserted.probability).toBe(70);
    expect(inserted.owner_id).toBe("tm-1");
    // Procedência canônica — sem ela o INSERT em prod é recusado por
    // fn_deals_exige_procedencia (CHECK deals_source_check).
    expect(inserted.source).toBe("workflow");
    // marca de origem — alimenta o guard de chain_depth do trigger deal_created
    expect(inserted.metadata).toMatchObject({
      created_by: "workflow",
      workflow_execution_id: "exec-9",
    });
    expect(result.data?.deal_id).toBeDefined();
  });

  it("clamps probability to 0..100", async () => {
    const { sb, getInserted } = seed();
    await createDeal({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      conversationId: null, params: { dealProbability: 250 },
    });
    expect((getInserted("deals")[0] as Record<string, unknown>).probability).toBe(100);
  });

  it("skips when the lead already has an open deal", async () => {
    const mock = seed();
    mock.mockTable("deals", [
      { id: "deal-open", organization_id: "org-1", source_lead_id: "lead-1", won: null, deleted_at: null },
    ]);

    const result = await createDeal({
      supabase: mock.sb, organizationId: "org-1", leadId: "lead-1",
      conversationId: null, params: {},
    });

    expect(result.success).toBe(true);
    expect(result.data?.skipped).toBe(true);
    expect(mock.getInserted("deals")).toHaveLength(0);
  });

  it("creates a second deal when the dedup guard is off", async () => {
    const mock = seed();
    mock.mockTable("deals", [
      { id: "deal-open", organization_id: "org-1", source_lead_id: "lead-1", won: null, deleted_at: null },
    ]);

    const result = await createDeal({
      supabase: mock.sb, organizationId: "org-1", leadId: "lead-1",
      conversationId: null, params: { dealSkipIfOpenExists: false },
    });

    expect(result.success).toBe(true);
    expect(mock.getInserted("deals")).toHaveLength(1);
  });
});

// ── SCRUM: desfecho é fato do negócio (ADR-0023 Emenda 1) ───────────────────
//
// Antes, `win_deal` movia o card para a etapa terminal e FALHAVA em 283 dos 396
// funis ativos (71%), que não têm etapa `won`. Agora o desfecho vive em
// `deals.outcome` e o card não se move.
//
// O que estes testes protegem, em ordem de custo do erro:
//
//   1. NÃO gravar duas vezes. O caderno `sale_events` é append-only (ADR-0017
//      §4): uma venda duplicada não se apaga. Como a escrita no caderno é
//      disparada pela TRANSIÇÃO de `outcome`, gravar um desfecho que já vale
//      emitiria um segundo evento.
//   2. NÃO mover o card. Mover é o comportamento antigo e é o que impedia
//      ganhar em funil sem etapa terminal.
//   3. Materializar `deals` quando falta (26,6% das entradas em prod), em vez
//      de falhar.
function seedEncerrar(over: { deal_id?: string | null; outcome?: string } = {}) {
  const mock = createMockSupabase();
  mock.mockTable("leads", [LEAD]);
  mock.mockTable("pipeline_entries", [{
    id: "entry-1",
    organization_id: "org-1",
    lead_id: "lead-1",
    pipeline_id: "pipe-1",
    stage_key: "negociando",
    deal_id: over.deal_id === undefined ? "deal-1" : over.deal_id,
  }]);
  mock.mockTable("deals", [{
    id: "deal-1",
    organization_id: "org-1",
    outcome: over.outcome ?? "open",
    value: 5000,
  }]);
  return mock;
}

function inputEncerrar(mock: ReturnType<typeof createMockSupabase>, params = {}) {
  return {
    supabase: mock.sb,
    organizationId: "org-1",
    entryId: "entry-1",
    leadId: "lead-1",
    params,
  } as never;
}

describe("winDeal / loseDeal — desfecho sem mover o card", () => {
  it("marca ganho e NÃO toca em pipeline_entries", async () => {
    const mock = seedEncerrar();
    const r = await winDeal(inputEncerrar(mock));

    expect(r.success).toBe(true);
    expect((r.data as Record<string, unknown>).outcome).toBe("won");
    // O card fica onde está — é isto que permite ganhar em qualquer etapa.
    expect((r.data as Record<string, unknown>).moved).toBe(false);
    expect(mock.getUpdated("pipeline_entries")).toHaveLength(0);

    const deal = mock.getUpdated("deals")[0] as Record<string, unknown>;
    expect(deal.outcome).toBe("won");
    expect(deal.outcome_source).toBe("workflow");
  });

  it("marca perda e grava o motivo quando veio", async () => {
    const mock = seedEncerrar();
    const r = await loseDeal(inputEncerrar(mock, { lossReason: "Preço" }));

    expect(r.success).toBe(true);
    const deal = mock.getUpdated("deals")[0] as Record<string, unknown>;
    expect(deal.outcome).toBe("lost");
    expect(deal.loss_reason).toBe("Preço");
    expect(mock.getUpdated("pipeline_entries")).toHaveLength(0);
  });

  it("🔴 negócio JÁ ganho não grava de novo — o caderno é append-only", async () => {
    const mock = seedEncerrar({ outcome: "won" });
    const r = await winDeal(inputEncerrar(mock));

    expect(r.success).toBe(true);
    expect((r.data as Record<string, unknown>).idempotent).toBe(true);
    // Nenhuma escrita: um UPDATE aqui dispararia a transição e emitiria uma
    // SEGUNDA venda, que ninguém consegue apagar depois.
    expect(mock.getUpdated("deals")).toHaveLength(0);
  });

  it("entrada sem negócio materializa a linha em vez de falhar", async () => {
    const mock = seedEncerrar({ deal_id: null });
    mock.mockRpc("garantir_negocio_da_entrada", "deal-1");

    const r = await winDeal(inputEncerrar(mock));

    expect(r.success).toBe(true);
    const chamadas = mock.getRpcCalls().filter((c) => c.name === "garantir_negocio_da_entrada");
    expect(chamadas).toHaveLength(1);
    expect((chamadas[0].params as Record<string, unknown>).p_entry_id).toBe("entry-1");
  });

  it("não inventa negócio quando a execução não tem funil nem negócio", async () => {
    const mock = seedEncerrar();
    const r = await winDeal({
      supabase: mock.sb, organizationId: "org-1", entryId: null, leadId: "lead-1", params: {},
    } as never);

    expect(r.success).toBe(false);
    expect(r.retryable).toBe(false);
    expect(mock.getUpdated("deals")).toHaveLength(0);
  });

  it("negócio de outra organização não é encerrado", async () => {
    const mock = seedEncerrar();
    const r = await winDeal({
      supabase: mock.sb, organizationId: "org-INTRUSA", entryId: "entry-1", leadId: "lead-1", params: {},
    } as never);

    expect(r.success).toBe(false);
    expect(mock.getUpdated("deals")).toHaveLength(0);
  });
});
