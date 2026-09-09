/**
 * Follow-up e ação do dia passam a ser do Negócio.
 *
 * Decisão do CTO, 2026-08-25: *"follow-up e ação do dia seguem o checklist, do
 * negócio"*. Mesma regra do ADR-0031: nasce DO NEGÓCIO quando o evento que o
 * criou foi de funil; nasce DA PESSOA quando o evento foi da pessoa, e aí vale
 * para todos os negócios dela.
 *
 * ── UMA DIFERENÇA EM RELAÇÃO AO CHECKLIST ─────────────────────────────────
 * O checklist do negócio morre com o card (`ON DELETE CASCADE`): sem card ele
 * não tem assunto. A tarefa NÃO — ela tem dono e prazo e está na agenda de
 * alguém. `ON DELETE SET NULL`: ela volta a ser tarefa da pessoa. "Ligar para o
 * fulano" não deixa de fazer sentido porque o card sumiu.
 */
import { describe, it, expect } from "vitest";
import { createFollowup } from "../../supabase/functions/_shared/action-handlers/followup-operations";
import { scheduleMeeting } from "../../supabase/functions/_shared/action-handlers/schedule-meeting";
import { createMockSupabase } from "../helpers/supabase-mock";

const ENTRY = "11111111-1111-4111-8111-111111111111";
const DEAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function cenario() {
  const mock = createMockSupabase();
  mock.mockTable("leads", [
    { id: "lead-1", organization_id: "org-1", responsible_id: "tm-1", sdr_id: null, closer_id: null },
  ]);
  mock.mockTable("follow_ups", []);
  return mock;
}

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

describe("create_followup — a tarefa é do Negócio", () => {
  it("carimba o negócio que disparou", async () => {
    const mock = cenario();
    const r = await createFollowup(entrada(mock, { params: { followupTitle: "Cobrar proposta" } }));

    expect(r.success).toBe(true);
    const [tarefa] = mock.getInserted("follow_ups");
    expect(tarefa.pipeline_entry_id).toBe(ENTRY);
    expect(tarefa.deal_id).toBe(DEAL);
    // O lead continua gravado: a tarefa é do Negócio E da pessoa por trás dele.
    expect(tarefa.lead_id).toBe("lead-1");
  });

  it("gatilho da pessoa cria tarefa DA PESSOA — sem carimbo", async () => {
    const mock = cenario();
    await createFollowup(entrada(mock, { entryId: null, dealId: null, params: {} }));

    const [tarefa] = mock.getInserted("follow_ups");
    expect(tarefa.pipeline_entry_id).toBeNull();
    expect(tarefa.deal_id).toBeNull();
  });

  it("dois negócios do mesmo lead sustentam tarefas separadas", async () => {
    const mock = cenario();
    await createFollowup(entrada(mock, { entryId: ENTRY, params: { followupTitle: "A" } }));
    await createFollowup(entrada(mock, { entryId: "22222222-2222-4222-8222-222222222222", params: { followupTitle: "B" } }));

    const tarefas = mock.getInserted("follow_ups");
    expect(tarefas).toHaveLength(2);
    expect(new Set(tarefas.map((t) => t.pipeline_entry_id)).size).toBe(2);
  });
});

describe("schedule_meeting — a reunião é do Negócio", () => {
  it("carimba o negócio na tarefa da reunião", async () => {
    const mock = cenario();
    const r = await scheduleMeeting(
      entrada(mock, { params: { date: "2026-09-01", time: "14:00", notes: "Discovery" } }),
    );

    expect(r.success).toBe(true);
    const [tarefa] = mock.getInserted("follow_ups");
    expect(tarefa.pipeline_entry_id).toBe(ENTRY);
    expect(tarefa.source_pipe).toBe("meeting");
  });

  it("sem negócio declarado, a reunião fica da pessoa", async () => {
    const mock = cenario();
    await scheduleMeeting(entrada(mock, { entryId: null, dealId: null, params: { date: "2026-09-01" } }));

    expect(mock.getInserted("follow_ups")[0].pipeline_entry_id).toBeNull();
  });
});
