/**
 * F5b — Testes time-aware nos tool handlers (schedule_meeting + transfer_to_human).
 *
 * Mock supabase client mínimo. Cobre:
 *   - schedule_meeting bloqueia slot fora janela com behavior
 *   - schedule_meeting passa-through quando agente sem behavior_windows configurado
 *   - schedule_meeting passa-through quando todas janelas têm behavior vazio (legacy)
 *   - transfer_to_human varia mensagem por janela ativa
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub Deno global pra módulos que usam Deno.env (google-calendar-utils chain).
(globalThis as any).Deno = (globalThis as any).Deno || { env: { get: () => undefined } };

const { executeAiAction } = await import('../../supabase/functions/_shared/ai-action-executor');

type MockTable = {
  data: any;
  selectCols?: string;
  filters: Record<string, any>;
};

function makeMockSupabase(opts: {
  conversation?: { agent_id: string };
  agent?: { behavior_windows: any[]; behavior_enforcement: string; availability: { timezone?: string } };
  lead?: any;
  pipeConfirmacao?: any;
}) {
  const updates: any[] = [];
  const inserts: any[] = [];

  const builder = (table: string) => {
    const state: MockTable = { data: null, filters: {} };
    const obj: any = {
      select: (cols: string) => { state.selectCols = cols; return obj; },
      insert: (rec: any) => { inserts.push({ table, rec }); state.data = rec; return obj; },
      update: (patch: any) => { updates.push({ table, patch }); return obj; },
      eq: (col: string, val: any) => { state.filters[col] = val; return obj; },
      maybeSingle: async () => {
        if (table === 'conversations') return { data: opts.conversation ?? null, error: null };
        if (table === 'copilot_agents') return { data: opts.agent ?? null, error: null };
        if (table === 'leads') return { data: opts.lead ?? null, error: null };
        if (table === 'pipe_confirmacao') return { data: opts.pipeConfirmacao ?? null, error: null };
        return { data: null, error: null };
      },
      single: async () => {
        if (table === 'leads') return { data: opts.lead ?? null, error: null };
        if (table === 'pipe_confirmacao') return { data: opts.pipeConfirmacao ?? { id: 'p1' }, error: null };
        return { data: null, error: null };
      },
    };
    return obj;
  };

  return {
    from: builder,
    _state: { updates, inserts },
  } as any;
}

describe('schedule_meeting — F5b time-aware blocking', () => {
  beforeEach(() => vi.clearAllMocks());

  it('bloqueia slot domingo 14h quando agente tem só janela Comercial seg-sex', async () => {
    const supabase = makeMockSupabase({
      conversation: { agent_id: 'a1' },
      agent: {
        behavior_windows: [
          { id: 'w1', name: 'Comercial', days: ['mon','tue','wed','thu','fri'], start: '09:00', end: '18:00', behavior: 'tom formal' },
        ],
        behavior_enforcement: 'hard',
        availability: { timezone: 'America/Sao_Paulo' },
      },
    });

    const result = await executeAiAction(supabase, {
      id: 'act1',
      organization_id: 'org1',
      lead_id: 'lead1',
      conversation_id: 'conv1',
      action_type: 'schedule_meeting',
      payload: { lead_id: 'lead1', preferred_date: '2026-04-26', preferred_time: '14:00' }, // domingo
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/fora de janela comercial/i);
  });

  it('permite slot segunda 14h quando agente tem janela Comercial seg-sex', async () => {
    const supabase = makeMockSupabase({
      conversation: { agent_id: 'a1' },
      agent: {
        behavior_windows: [
          { id: 'w1', name: 'Comercial', days: ['mon','tue','wed','thu','fri'], start: '09:00', end: '18:00', behavior: 'tom formal' },
        ],
        behavior_enforcement: 'hard',
        availability: { timezone: 'America/Sao_Paulo' },
      },
      lead: { name: 'Lead Test', email: 'a@b.com', responsible_id: null, sdr_id: null },
    });

    const result = await executeAiAction(supabase, {
      id: 'act1',
      organization_id: 'org1',
      lead_id: 'lead1',
      conversation_id: 'conv1',
      action_type: 'schedule_meeting',
      payload: { lead_id: 'lead1', preferred_date: '2026-04-27', preferred_time: '14:00' }, // segunda
    });

    expect(result.success).toBe(true);
  });

  it('passa-through quando agente sem behavior_windows (legacy)', async () => {
    const supabase = makeMockSupabase({
      conversation: { agent_id: 'a1' },
      agent: {
        behavior_windows: [],
        behavior_enforcement: 'hard',
        availability: { timezone: 'America/Sao_Paulo' },
      },
      lead: { name: 'Lead', email: null, responsible_id: null, sdr_id: null },
    });

    const result = await executeAiAction(supabase, {
      id: 'act1',
      organization_id: 'org1',
      lead_id: 'lead1',
      conversation_id: 'conv1',
      action_type: 'schedule_meeting',
      payload: { lead_id: 'lead1', preferred_date: '2026-04-26', preferred_time: '23:00' }, // domingo madrugada
    });

    expect(result.success).toBe(true);
  });

  it('passa-through quando todas janelas com behavior vazio (backfill default)', async () => {
    const supabase = makeMockSupabase({
      conversation: { agent_id: 'a1' },
      agent: {
        behavior_windows: [
          { id: 'w1', name: 'Padrão', days: ['mon','tue','wed','thu','fri','sat','sun'], start: '00:00', end: '23:59', behavior: '' },
        ],
        behavior_enforcement: 'hard',
        availability: { timezone: 'America/Sao_Paulo' },
      },
      lead: { name: 'Lead', email: null, responsible_id: null, sdr_id: null },
    });

    const result = await executeAiAction(supabase, {
      id: 'act1',
      organization_id: 'org1',
      lead_id: 'lead1',
      conversation_id: 'conv1',
      action_type: 'schedule_meeting',
      payload: { lead_id: 'lead1', preferred_date: '2026-04-26', preferred_time: '23:00' },
    });

    expect(result.success).toBe(true);
  });
});

describe('transfer_to_human — F5b time-aware message variation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mensagem com nome da janela quando agente tem janela ativa com behavior', async () => {
    // Note: usa hora atual do sistema. Esse teste é flaky para horário específico,
    // então mocka uma janela 7d/24h com behavior preenchido pra garantir match.
    const supabase = makeMockSupabase({
      conversation: { agent_id: 'a1' },
      agent: {
        behavior_windows: [
          { id: 'w1', name: 'Sempre', days: ['mon','tue','wed','thu','fri','sat','sun'], start: '00:00', end: '23:59', behavior: 'sempre transferir imediato' },
        ],
        behavior_enforcement: 'hard',
        availability: { timezone: 'America/Sao_Paulo' },
      },
    });

    const result = await executeAiAction(supabase, {
      id: 'act1',
      organization_id: 'org1',
      lead_id: 'lead1',
      conversation_id: 'conv1',
      action_type: 'transfer_to_human',
      payload: { lead_id: 'lead1' },
    });

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Sempre/);
  });

  it('mensagem fallback quando janela ativa sem behavior', async () => {
    const supabase = makeMockSupabase({
      conversation: { agent_id: 'a1' },
      agent: {
        behavior_windows: [
          { id: 'w1', name: 'Padrão', days: ['mon','tue','wed','thu','fri','sat','sun'], start: '00:00', end: '23:59', behavior: '' },
        ],
        behavior_enforcement: 'hard',
        availability: { timezone: 'America/Sao_Paulo' },
      },
    });

    const result = await executeAiAction(supabase, {
      id: 'act1',
      organization_id: 'org1',
      lead_id: 'lead1',
      conversation_id: 'conv1',
      action_type: 'transfer_to_human',
      payload: { lead_id: 'lead1' },
    });

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/fora do horário comercial/i);
  });

  it('mensagem default legacy quando agente sem behavior_windows', async () => {
    const supabase = makeMockSupabase({
      conversation: { agent_id: 'a1' },
      agent: {
        behavior_windows: [],
        behavior_enforcement: 'hard',
        availability: { timezone: 'America/Sao_Paulo' },
      },
    });

    const result = await executeAiAction(supabase, {
      id: 'act1',
      organization_id: 'org1',
      lead_id: 'lead1',
      conversation_id: 'conv1',
      action_type: 'transfer_to_human',
      payload: { lead_id: 'lead1' },
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Conversa transferida para humano');
  });
});
