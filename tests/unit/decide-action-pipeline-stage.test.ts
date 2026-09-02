/**
 * enqueuePipelineStageUpdate — avanço automático de etapa pelo turn do Copilot.
 *
 * ADR-0023 §10: a etapa corrente é a do NEGÓCIO (`pipeline_entries`), não a da
 * coluna legada `leads.pipe_whatsapp`. Dois motivos medidos:
 *
 *   - o espelho legado já diverge do card em 1.885 leads de 34 orgs;
 *   - em L2 um gatilho passa a ZERAR a coluna quando o negócio sai de
 *     Oportunidades — ler dali faria o agente mudar de comportamento sozinho,
 *     em silêncio, no primeiro dia da piloto.
 *
 * E o caso sem negócio deixou de ser inofensivo: o `update_pipeline_stage` que
 * saía daqui é executado por `executeUpdatePipelineStage`, que chama
 * `upsertPipeEntry` — e esse INSERE a entry quando não existe. Ou seja, o agente
 * CRIAVA o negócio. ADR-0023 §3: negócio nasce só por clique humano.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { enqueued, pipeEntries } = vi.hoisted(() => ({
  enqueued: [] as Array<Record<string, unknown>>,
  pipeEntries: {} as Record<string, unknown>,
}));

vi.mock("../../supabase/functions/_shared/ai-queue.ts", () => ({
  enqueueAiAction: vi.fn(async (_sb: unknown, params: Record<string, unknown>) => {
    enqueued.push(params);
    return { success: true };
  }),
}));

vi.mock("../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  getPipeEntry: vi.fn(
    async (_sb: unknown, _leadId: string, _orgId: string, slug: string) => pipeEntries[slug] ?? null,
  ),
  getPipeEntriesByLeads: vi.fn().mockResolvedValue([]),
  // SCRUM-623: o contrato novo LANÇA em funil não resolvido — null saiu do tipo.
  resolvePipelineId: vi.fn(async () => {
    throw new Error("pipeline_not_found (mock — contrato SCRUM-623 lança, não devolve null)");
  }),
  tryResolvePipelineId: vi.fn().mockResolvedValue(null),
}));

import { enqueuePipelineStageUpdate } from "../../supabase/functions/agent-message/engine/decide-action.ts";

/**
 * Client que EXPLODE se alguém tentar ler `leads`. É a asserção central deste
 * arquivo: o caminho não pode voltar a consultar a coluna legada.
 */
function supabaseThatForbidsLeadReads() {
  return {
    from: (table: string) => {
      throw new Error(`decide-action não deve consultar a tabela "${table}" aqui`);
    },
  } as never;
}

const ORG = "org-1";
const LEAD = "lead-1";

describe("enqueuePipelineStageUpdate", () => {
  beforeEach(() => {
    enqueued.length = 0;
    for (const k of Object.keys(pipeEntries)) delete pipeEntries[k];
  });

  it("lê a etapa do negócio no funil WhatsApp, nunca de leads.pipe_whatsapp", async () => {
    pipeEntries.whatsapp = { id: "entry-1", stage_key: "novo" };

    await enqueuePipelineStageUpdate(supabaseThatForbidsLeadReads(), ORG, LEAD, 1, null);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].actionType).toBe("update_pipeline_stage");
    expect((enqueued[0].payload as Record<string, unknown>).new_stage).toBe("abordado");
    expect((enqueued[0].payload as Record<string, unknown>).previous_stage).toBe("novo");
  });

  it("avança abordado → respondeu", async () => {
    pipeEntries.whatsapp = { id: "entry-1", stage_key: "abordado" };

    await enqueuePipelineStageUpdate(supabaseThatForbidsLeadReads(), ORG, LEAD, 4, null);

    expect((enqueued[0].payload as Record<string, unknown>).new_stage).toBe("respondeu");
  });

  it("SCHEDULE_MEETING leva o negócio para agendado", async () => {
    pipeEntries.whatsapp = { id: "entry-1", stage_key: "respondeu" };

    await enqueuePipelineStageUpdate(supabaseThatForbidsLeadReads(), ORG, LEAD, 6, {
      action: "SCHEDULE_MEETING",
    });

    expect((enqueued[0].payload as Record<string, unknown>).new_stage).toBe("agendado");
  });

  it("sem negócio no funil, não enfileira nada — automação não abre negócio (§3)", async () => {
    await enqueuePipelineStageUpdate(supabaseThatForbidsLeadReads(), ORG, LEAD, 1, null);

    expect(enqueued).toHaveLength(0);
  });

  it("sem negócio, nem SCHEDULE_MEETING enfileira — era por aqui que o agente criava um", async () => {
    // Antes: entry ausente caía no ramo `newStage = "agendado"`, o executor
    // chamava `upsertPipeEntry` e a entry NASCIA a partir de uma automação.
    await enqueuePipelineStageUpdate(supabaseThatForbidsLeadReads(), ORG, LEAD, 6, {
      action: "SCHEDULE_MEETING",
    });

    expect(enqueued).toHaveLength(0);
  });

  it("ADVANCE_STAGE sai antes de qualquer leitura — vira tool call, não duplica", async () => {
    pipeEntries.whatsapp = { id: "entry-1", stage_key: "novo" };

    await enqueuePipelineStageUpdate(supabaseThatForbidsLeadReads(), ORG, LEAD, 1, {
      action: "ADVANCE_STAGE",
    });

    expect(enqueued).toHaveLength(0);
  });

  it("etapa fora do conjunto padrão não é avançada por turn", async () => {
    pipeEntries.whatsapp = { id: "entry-1", stage_key: "etapa_customizada_da_org" };

    await enqueuePipelineStageUpdate(supabaseThatForbidsLeadReads(), ORG, LEAD, 1, null);

    expect(enqueued).toHaveLength(0);
  });

  it("não reenfileira quando o negócio já está na etapa de destino", async () => {
    pipeEntries.whatsapp = { id: "entry-1", stage_key: "agendado" };

    await enqueuePipelineStageUpdate(supabaseThatForbidsLeadReads(), ORG, LEAD, 6, {
      action: "SCHEDULE_MEETING",
    });

    expect(enqueued).toHaveLength(0);
  });
});
