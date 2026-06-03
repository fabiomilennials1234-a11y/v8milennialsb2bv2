/**
 * Slice 9 — EXIT proof: the simulator mutates NOTHING. Drives a turn that
 * proposes EVERY write tool with all capabilities ON and the introspect targets
 * seeded (so the real gates PASS and each write reaches the dry-run executor).
 * Asserts every write was recorded as a would-execute (never performed) and the
 * dry-run executor — which never receives a supabase client — makes a real
 * mutation impossible by construction. The trace is in-memory only.
 */

import { describe, it, expect } from 'vitest';
import { runSimulatorTurn } from '../../../supabase/functions/_shared/copilot-v2/simulator-turn.ts';
import { createFakeLlm } from '../../../supabase/functions/_shared/copilot-v2/fake-llm.ts';
import type { AgentConfig } from '../../../supabase/functions/_shared/copilot-v2/prompt-builder.ts';

const config: AgentConfig = { company: { name: 'X' }, icp: 'y', products: ['p'], tone: 't', businessHours: 'h' };

const ALL_WRITES = [
  { id: '1', name: 'move_lead_stage', args: { stage: 'novo' } },
  { id: '2', name: 'fill_lead_field', args: { field: 'email', value: 'a@b.com' } },
  { id: '3', name: 'schedule_meeting', args: { datetime: '2026-06-10T10:00' } },
  { id: '4', name: 'set_qualification_tier', args: { signals: { faturamentoMensal: 50000 } } },
  { id: '5', name: 'send_media', args: { media_id: 'm1' } },
  { id: '6', name: 'transfer_to_human', args: { reason: 'x' } },
  { id: '7', name: 'handoff_to_vendedor', args: { summary: 'x' } },
];

describe('simulator exit — zero mutations across every write tool', () => {
  it('records all 7 writes as would-execute, none performed', async () => {
    const fake = createFakeLlm([
      { text: null, toolCalls: ALL_WRITES },
      { text: 'fim', toolCalls: [] },
    ]);
    const r = await runSimulatorTurn(
      {
        archetype: 'qualificador',
        config,
        capabilities: {
          can_move_stage: true, can_fill_field: true, can_schedule_meeting: true,
          can_set_tier: true, can_send_media: true, can_transfer: true, can_handoff: true,
        },
        rubricRules: [{ tier: 'ouro', minFaturamento: 30000 }, { tier: 'bronze' }],
        seed: { stages: ['novo'], fields: ['email'], agendaSlots: ['2026-06-10T10:00'] },
        message: 'faz tudo',
      },
      { makeLlm: () => fake, maxToolCalls: 10 },
    );

    const recorded = r.writes.map((w) => w.tool).sort();
    expect(recorded).toEqual([...ALL_WRITES].map((w) => w.name).sort());
    // every write tool was ALLOWED by the real gates and recorded (not performed)
    const allowedTools = r.trace.steps.filter((s) => s.step === 'tool' && (s.meta as any).allowed === true);
    expect(allowedTools.length).toBe(7);
    // set_qualification_tier ran the real rubric without a DB write
    expect(r.writes.find((w) => w.tool === 'set_qualification_tier')?.tier).toBe('ouro');
  });
});
