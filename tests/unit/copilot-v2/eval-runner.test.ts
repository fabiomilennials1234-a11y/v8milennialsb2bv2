/**
 * Slice 9 — eval-runner (Copilot v2). Runs each eval case through the dry-run
 * simulator and checks the deterministic outcome: Qualificador → tier via the
 * real rubric (exact match); Vendedor → first allowed WRITE tool === expected
 * tool. Carteira semantic 'expected_action' is deferred (SKIP) to a later wave.
 * Pure: the LLM + agent config are injected; ZERO DB writes.
 */

import { describe, it, expect } from 'vitest';
import { runEvalSuite, type EvalCase } from '../../../supabase/functions/_shared/copilot-v2/eval-runner.ts';
import { createFakeLlm } from '../../../supabase/functions/_shared/copilot-v2/fake-llm.ts';
import type { LlmResponse } from '../../../supabase/functions/_shared/copilot-v2/cognition-loop.ts';

const text: LlmResponse = { text: 'ok', toolCalls: [] };
const baseConfig = { company: { name: 'X' }, icp: 'y', products: ['p'], tone: 't', businessHours: 'h' };

const agentFor = (archetype: any) => {
  if (archetype === 'qualificador') {
    return { config: baseConfig, capabilities: { can_set_tier: true }, rubricRules: [{ tier: 'diamante', minFaturamento: 100000 }, { tier: 'bronze' }] };
  }
  if (archetype === 'vendedor') {
    return { config: baseConfig, capabilities: { can_schedule_meeting: true } };
  }
  return { config: baseConfig, capabilities: { can_transfer: true } };
};

function tierCase(over: Partial<EvalCase> = {}): EvalCase {
  return { id: 'c1', caseName: 'tier', archetype: 'qualificador', inputMessage: 'faturo 200k', enabled: true, expectedTier: 'diamante', ...over };
}

describe('runEvalSuite — qualificador tier (exact match)', () => {
  // Fresh FakeLlm per case — the client is stateful (records calls), so reusing
  // one across cases would exhaust its script.
  const tierBig = () =>
    createFakeLlm([
      { text: null, toolCalls: [{ id: '1', name: 'set_qualification_tier', args: { signals: { faturamentoMensal: 200000 } } }] },
      text,
    ]);

  it('PASS when the rubric-derived tier equals the expected tier', async () => {
    const llm = tierBig();
    const res = await runEvalSuite([tierCase()], { agentFor, makeLlm: () => llm });
    expect(res[0].status).toBe('pass');
    expect(res[0].actual).toMatchObject({ tier: 'diamante' });
  });

  it('FAIL when the tier differs', async () => {
    const llm = tierBig();
    const res = await runEvalSuite([tierCase({ expectedTier: 'ouro' })], { agentFor, makeLlm: () => llm });
    expect(res[0].status).toBe('fail');
    expect(res[0].reasoning).toMatch(/diamante/);
  });
});

describe('runEvalSuite — vendedor first allowed write tool', () => {
  it('PASS when the first allowed write tool matches expected_tool', async () => {
    const llm = createFakeLlm([
      { text: null, toolCalls: [{ id: '1', name: 'schedule_meeting', args: { datetime: '2026-06-10T10:00' } }] },
      text,
    ]);
    const c: EvalCase = { id: 'v1', caseName: 'agenda', archetype: 'vendedor', inputMessage: 'quero reunião', enabled: true, expectedTool: 'schedule_meeting' };
    const res = await runEvalSuite([c], { agentFor, makeLlm: () => llm, seedFor: () => ({ agendaSlots: ['2026-06-10T10:00'] }) });
    expect(res[0].status).toBe('pass');
    expect(res[0].actual).toMatchObject({ tool: 'schedule_meeting' });
  });
});

describe('runEvalSuite — skip + error', () => {
  it('SKIP a disabled case (no LLM call)', async () => {
    const res = await runEvalSuite([tierCase({ enabled: false })], { agentFor, makeLlm: () => createFakeLlm([text]) });
    expect(res[0].status).toBe('skip');
  });

  it('SKIP a carteira case that only has a semantic expected_action (deferred)', async () => {
    const c: EvalCase = { id: 'ca1', caseName: 'sem', archetype: 'carteira', inputMessage: 'oi', enabled: true, expectedAction: 'reabrir com novidade' };
    const res = await runEvalSuite([c], { agentFor, makeLlm: () => createFakeLlm([text]) });
    expect(res[0].status).toBe('skip');
    expect(res[0].reasoning).toMatch(/deferred|semantic|adiad/i);
  });

  it('ERROR (never throws out) when the LLM call fails', async () => {
    const boom = { complete: async () => { throw new Error('llm down'); } };
    const res = await runEvalSuite([tierCase()], { agentFor, makeLlm: () => boom as any });
    expect(res[0].status).toBe('error');
  });
});
