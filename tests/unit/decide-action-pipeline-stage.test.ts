/**
 * enqueuePipelineStageUpdate — avanço automático de etapa pelo turn do Copilot.
 *
 * SCRUM-628 (W3 · Funil é Funil): o avanço deixou de ser a trilha hardcoded
 * ["novo","abordado","respondeu","esfriou","agendado"] do funil WhatsApp:
 *
 *   - o funil vem das kanban rules do agente (fallback "whatsapp" sem regra);
 *   - avanço por turn = próxima etapa `stage_role='open'` na ordem de position
 *     (turn 1 na 1ª open → 2ª; 2ª open → 3ª; do resto ninguém avança sozinho);
 *   - SCHEDULE_MEETING → etapa `stage_role='meeting_booked'` do funil; funil
 *     sem etapa meeting_booked NÃO move;
 *   - entry em etapa não-open não é movida.
 *
 * Guards preservados do ADR-0023:
 *   §10 — a etapa corrente é a do NEGÓCIO (`pipeline_entries`), nunca de
 *         `leads.pipe_whatsapp` (o client de teste EXPLODE se ler `leads`);
 *   §3  — sem negócio, NADA é enfileirado (automação não abre negócio).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { enqueued, pipeEntries, stagesByPipeline } = vi.hoisted(() => ({
  enqueued: [] as Array<Record<string, unknown>>,
  pipeEntries: {} as Record<string, unknown>,
  stagesByPipeline: {} as Record<string, Array<Record<string, unknown>>>,
}));

vi.mock("../../supabase/functions/_shared/ai-queue.ts", () => ({
  enqueueAiAction: vi.fn(async (_sb: unknown, params: Record<string, unknown>) => {
    enqueued.push(params);
    return { success: true };
  }),
}));

vi.mock("../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  getPipeEntry: vi.fn(
    async (_sb: unknown, _leadId: string, _orgId: string, ref: string) => pipeEntries[ref] ?? null,
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
 * Client que serve `pipeline_stages` (etapas do funil, por pipeline_id) e
 * EXPLODE em qualquer outra tabela — em especial `leads`: o caminho não pode
 * voltar a consultar a coluna legada (§10).
 */
function supabaseComEtapas() {
  return {
    from: (table: string) => {
      if (table !== "pipeline_stages") {
        throw new Error(`decide-action não deve consultar a tabela "${table}" aqui`);
      }
      const filters: Record<string, unknown> = {};
      interface StageChain {
        select: () => StageChain;
        eq: (col: string, val: unknown) => StageChain;
        order: () => Promise<{ data: Array<Record<string, unknown>>; error: null }>;
      }
      const b: StageChain = {
        select: () => b,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return b;
        },
        order: () =>
          Promise.resolve({
            data: stagesByPipeline[String(filters.pipeline_id)] ?? [],
            error: null,
          }),
      };
      return b;
    },
  } as never;
}

const ORG = "org-1";
const LEAD = "lead-1";

/** Funil WhatsApp semeado — mesmo shape que o seed de prod. */
const WHATSAPP_STAGES = [
  { id: "st-novo", stage_key: "novo", position: 0, stage_role: "open" },
  { id: "st-abordado", stage_key: "abordado", position: 1, stage_role: "open" },
  { id: "st-respondeu", stage_key: "respondeu", position: 2, stage_role: "open" },
  { id: "st-esfriou", stage_key: "esfriou", position: 3, stage_role: "open" },
  { id: "st-agendado", stage_key: "agendado", position: 4, stage_role: "meeting_booked" },
];

/** Funil custom com keys próprias e papel governado (W2). */
const CUSTOM_STAGES = [
  { id: "cs-entrada", stage_key: "entrada", position: 0, stage_role: "open" },
  { id: "cs-contato", stage_key: "contato_feito", position: 1, stage_role: "open" },
  { id: "cs-negociando", stage_key: "negociando", position: 2, stage_role: "open" },
  { id: "cs-reuniao", stage_key: "reuniao_marcada", position: 3, stage_role: "meeting_booked" },
  { id: "cs-ganho", stage_key: "ganho", position: 4, stage_role: "won" },
];

const CUSTOM_PIPE_ID = "11111111-2222-3333-4444-555555555555";

const capsComRegraCustom = {
  copilot_agent_kanban_rules: [
    { pipe_type: CUSTOM_PIPE_ID, stage_name: "cs-entrada", goal: "g", behavior: "b" },
  ],
};

function entry(pipelineId: string, stage: { id: string; stage_key: string }, id = "entry-1") {
  return { id, pipeline_id: pipelineId, stage_id: stage.id, stage_key: stage.stage_key };
}

describe("enqueuePipelineStageUpdate", () => {
  beforeEach(() => {
    enqueued.length = 0;
    for (const k of Object.keys(pipeEntries)) delete pipeEntries[k];
    for (const k of Object.keys(stagesByPipeline)) delete stagesByPipeline[k];
    stagesByPipeline["pipe-wpp"] = WHATSAPP_STAGES;
    stagesByPipeline[CUSTOM_PIPE_ID] = CUSTOM_STAGES;
  });

  it("lê a etapa do negócio no funil WhatsApp, nunca de leads.pipe_whatsapp", async () => {
    pipeEntries.whatsapp = entry("pipe-wpp", WHATSAPP_STAGES[0]);

    await enqueuePipelineStageUpdate(supabaseComEtapas(), ORG, LEAD, 1, null);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].actionType).toBe("update_pipeline_stage");
    const payload = enqueued[0].payload as Record<string, unknown>;
    expect(payload.new_stage).toBe("abordado");
    expect(payload.previous_stage).toBe("novo");
    // SCRUM-628: o payload identifica O NEGÓCIO — o executor move por id, sem upsert.
    expect(payload.entry_id).toBe("entry-1");
    expect(payload.target_pipe).toBe("pipe-wpp");
    expect(payload.stage_id).toBe("st-abordado");
  });

  it("avança abordado → respondeu (2ª etapa open → 3ª, em qualquer turn)", async () => {
    pipeEntries.whatsapp = entry("pipe-wpp", WHATSAPP_STAGES[1]);

    await enqueuePipelineStageUpdate(supabaseComEtapas(), ORG, LEAD, 4, null);

    expect((enqueued[0].payload as Record<string, unknown>).new_stage).toBe("respondeu");
  });

  it("SCHEDULE_MEETING leva o negócio para a etapa meeting_booked do funil", async () => {
    pipeEntries.whatsapp = entry("pipe-wpp", WHATSAPP_STAGES[2]);

    await enqueuePipelineStageUpdate(supabaseComEtapas(), ORG, LEAD, 6, {
      action: "SCHEDULE_MEETING",
    });

    expect((enqueued[0].payload as Record<string, unknown>).new_stage).toBe("agendado");
    expect((enqueued[0].payload as Record<string, unknown>).stage_id).toBe("st-agendado");
  });

  it("sem negócio no funil, não enfileira nada — automação não abre negócio (§3)", async () => {
    await enqueuePipelineStageUpdate(supabaseComEtapas(), ORG, LEAD, 1, null);

    expect(enqueued).toHaveLength(0);
  });

  it("sem negócio, nem SCHEDULE_MEETING enfileira — era por aqui que o agente criava um", async () => {
    await enqueuePipelineStageUpdate(supabaseComEtapas(), ORG, LEAD, 6, {
      action: "SCHEDULE_MEETING",
    });

    expect(enqueued).toHaveLength(0);
  });

  it("ADVANCE_STAGE sai antes de qualquer leitura — vira tool call, não duplica", async () => {
    pipeEntries.whatsapp = entry("pipe-wpp", WHATSAPP_STAGES[0]);

    await enqueuePipelineStageUpdate(supabaseComEtapas(), ORG, LEAD, 1, {
      action: "ADVANCE_STAGE",
    });

    expect(enqueued).toHaveLength(0);
  });

  it("etapa da 3ª posição open em diante não é avançada por turn", async () => {
    pipeEntries.whatsapp = entry("pipe-wpp", WHATSAPP_STAGES[2]); // respondeu

    await enqueuePipelineStageUpdate(supabaseComEtapas(), ORG, LEAD, 3, null);

    expect(enqueued).toHaveLength(0);
  });

  it("entry em etapa não-open (meeting_booked) não anda sozinha", async () => {
    pipeEntries.whatsapp = entry("pipe-wpp", WHATSAPP_STAGES[4]); // agendado

    await enqueuePipelineStageUpdate(supabaseComEtapas(), ORG, LEAD, 2, null);

    expect(enqueued).toHaveLength(0);
  });

  it("não reenfileira quando o negócio já está na etapa de destino", async () => {
    pipeEntries.whatsapp = entry("pipe-wpp", WHATSAPP_STAGES[4]); // agendado

    await enqueuePipelineStageUpdate(supabaseComEtapas(), ORG, LEAD, 6, {
      action: "SCHEDULE_MEETING",
    });

    expect(enqueued).toHaveLength(0);
  });

  // ── SCRUM-628: funil custom via kanban rules ──────────────────────────────

  it("agente com regra em funil custom avança pela ordem de position DELE", async () => {
    pipeEntries[CUSTOM_PIPE_ID] = entry(CUSTOM_PIPE_ID, CUSTOM_STAGES[0], "entry-c1");

    await enqueuePipelineStageUpdate(
      supabaseComEtapas(), ORG, LEAD, 1, null, capsComRegraCustom,
    );

    expect(enqueued).toHaveLength(1);
    const payload = enqueued[0].payload as Record<string, unknown>;
    expect(payload.new_stage).toBe("contato_feito");
    expect(payload.target_pipe).toBe(CUSTOM_PIPE_ID);
    expect(payload.entry_id).toBe("entry-c1");
  });

  it("SCHEDULE_MEETING em funil custom vai para a etapa stage_role=meeting_booked", async () => {
    pipeEntries[CUSTOM_PIPE_ID] = entry(CUSTOM_PIPE_ID, CUSTOM_STAGES[2], "entry-c1");

    await enqueuePipelineStageUpdate(
      supabaseComEtapas(), ORG, LEAD, 5, { action: "SCHEDULE_MEETING" }, capsComRegraCustom,
    );

    expect((enqueued[0].payload as Record<string, unknown>).new_stage).toBe("reuniao_marcada");
  });

  it("funil sem etapa meeting_booked: SCHEDULE_MEETING não move", async () => {
    stagesByPipeline[CUSTOM_PIPE_ID] = CUSTOM_STAGES.filter((s) => s.stage_role !== "meeting_booked");
    pipeEntries[CUSTOM_PIPE_ID] = entry(CUSTOM_PIPE_ID, CUSTOM_STAGES[1], "entry-c1");

    await enqueuePipelineStageUpdate(
      supabaseComEtapas(), ORG, LEAD, 5, { action: "SCHEDULE_MEETING" }, capsComRegraCustom,
    );

    expect(enqueued).toHaveLength(0);
  });

  it("negócio custom em etapa won não anda sozinho", async () => {
    pipeEntries[CUSTOM_PIPE_ID] = entry(CUSTOM_PIPE_ID, CUSTOM_STAGES[4], "entry-c1");

    await enqueuePipelineStageUpdate(
      supabaseComEtapas(), ORG, LEAD, 1, null, capsComRegraCustom,
    );

    expect(enqueued).toHaveLength(0);
  });

  it("sem negócio no funil da regra, cai no próximo funil citado pelas rules", async () => {
    const caps = {
      copilot_agent_kanban_rules: [
        { pipe_type: CUSTOM_PIPE_ID, stage_name: "cs-entrada" },
        { pipe_type: "whatsapp", stage_name: "novo" },
      ],
    };
    pipeEntries.whatsapp = entry("pipe-wpp", WHATSAPP_STAGES[0]);

    await enqueuePipelineStageUpdate(supabaseComEtapas(), ORG, LEAD, 1, null, caps);

    expect(enqueued).toHaveLength(1);
    expect((enqueued[0].payload as Record<string, unknown>).target_pipe).toBe("pipe-wpp");
  });

  it("regra de campanha não define funil — fallback whatsapp continua", async () => {
    const caps = {
      copilot_agent_kanban_rules: [{ pipe_type: "campanha", stage_name: "Etapa X" }],
    };
    pipeEntries.whatsapp = entry("pipe-wpp", WHATSAPP_STAGES[0]);

    await enqueuePipelineStageUpdate(supabaseComEtapas(), ORG, LEAD, 1, null, caps);

    expect(enqueued).toHaveLength(1);
    expect((enqueued[0].payload as Record<string, unknown>).new_stage).toBe("abordado");
  });
});
