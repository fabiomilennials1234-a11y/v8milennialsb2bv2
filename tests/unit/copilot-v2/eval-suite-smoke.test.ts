/**
 * Slice 9 — eval-suite CI smoke. A tiny golden set that must deterministically
 * PASS, so the vitest CI run blocks a regression in the dry-run spine / rubric
 * wiring (IMPLEMENTATION-PLAN: "eval-suite em CI bloqueando regressão"). Uses a
 * FakeLlm (deterministic); the real CI eval over live cases caches responses.
 */

import { describe, it, expect } from 'vitest';
import { runEvalSuite, type EvalCase } from '../../../supabase/functions/_shared/copilot-v2/eval-runner.ts';
import { createFakeLlm } from '../../../supabase/functions/_shared/copilot-v2/fake-llm.ts';

const cfg = { company: { name: 'X' }, icp: 'y', products: ['p'], tone: 't', businessHours: 'h' };
const text = { text: 'ok', toolCalls: [] };

const GOLDEN: EvalCase[] = [
  { id: 'g1', caseName: 'lead grande → ouro', archetype: 'qualificador', inputMessage: 'faturo 50k', enabled: true, expectedTier: 'ouro' },
  { id: 'g2', caseName: 'pede reunião → schedule', archetype: 'vendedor', inputMessage: 'quero reunião', enabled: true, expectedTool: 'schedule_meeting' },
];

// Deterministic per-case scripted model behaviour.
const scriptFor: Record<string, any[]> = {
  g1: [{ text: null, toolCalls: [{ id: '1', name: 'set_qualification_tier', args: { signals: { faturamentoMensal: 50000 } } }] }, text],
  g2: [{ text: null, toolCalls: [{ id: '1', name: 'schedule_meeting', args: { datetime: '2026-06-10T10:00' } }] }, text],
};

describe('eval-suite smoke (CI gate)', () => {
  it('all golden cases PASS deterministically', async () => {
    const res = await runEvalSuite(GOLDEN, {
      agentFor: (a) =>
        a === 'qualificador'
          ? { config: cfg, capabilities: { can_set_tier: true }, rubricRules: [{ tier: 'ouro', minFaturamento: 30000 }, { tier: 'bronze' }] }
          : { config: cfg, capabilities: { can_schedule_meeting: true } },
      makeLlm: (_m, c) => createFakeLlm(scriptFor[c.id]),
      seedFor: () => ({ agendaSlots: ['2026-06-10T10:00'] }),
    });
    expect(res.every((r) => r.status === 'pass')).toBe(true);
  });
});
