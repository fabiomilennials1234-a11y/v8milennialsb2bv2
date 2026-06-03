/**
 * Slice 9 — simulator-turn harness (Copilot v2). Proves the simulator REUSES the
 * cognition spine verbatim: the REAL base prompt is built from config, the REAL
 * capability-gate + write-after-introspect guards fire, and writes never mutate
 * (dry-run executor). FakeLlm + dry executor → zero network, zero DB.
 */

import { describe, it, expect } from 'vitest';
import { runSimulatorTurn } from '../../../supabase/functions/_shared/copilot-v2/simulator-turn.ts';
import { createFakeLlm } from '../../../supabase/functions/_shared/copilot-v2/fake-llm.ts';
import type { AgentConfig } from '../../../supabase/functions/_shared/copilot-v2/prompt-builder.ts';
import type { LlmResponse } from '../../../supabase/functions/_shared/copilot-v2/cognition-loop.ts';

const config: AgentConfig = {
  company: { name: 'Aço Forte', about: 'Distribuidora de aço B2B' },
  icp: 'construtoras',
  products: ['Vergalhão'],
  tone: 'consultivo',
  businessHours: 'Seg–Sex 08h–18h',
};
const textReply: LlmResponse = { text: 'Olá! Como posso ajudar?', toolCalls: [] };

describe('runSimulatorTurn — reuses the real spine', () => {
  it('builds the REAL system prompt from config (slots filled, no raw tokens)', async () => {
    const fake = createFakeLlm([textReply]);
    await runSimulatorTurn(
      { archetype: 'qualificador', config, capabilities: {}, message: 'oi' },
      { makeLlm: () => fake },
    );
    expect(fake.calls[0].system).toContain('Aço Forte');
    expect(fake.calls[0].system).not.toMatch(/\{\{[\w-]+\}\}/);
  });

  it('returns a DryRunTrace + reply for a plain text turn', async () => {
    const fake = createFakeLlm([textReply]);
    const r = await runSimulatorTurn(
      { archetype: 'qualificador', config, capabilities: {}, message: 'oi' },
      { makeLlm: () => fake },
    );
    expect(r.reply).toBe('Olá! Como posso ajudar?');
    expect(r.trace.result.archetype).toBe('qualificador');
    expect(r.writes).toHaveLength(0);
  });
});

describe('runSimulatorTurn — real gates fire before the executor', () => {
  it('blocks a write whose capability is OFF (never reaches the executor)', async () => {
    const fake = createFakeLlm([
      { text: null, toolCalls: [{ id: '1', name: 'move_lead_stage', args: { stage: 'novo' } }] },
      textReply,
    ]);
    const r = await runSimulatorTurn(
      { archetype: 'qualificador', config, capabilities: {}, seed: { stages: ['novo'] }, message: 'avança' },
      { makeLlm: () => fake },
    );
    const tool = r.trace.steps.find((s) => s.step === 'tool');
    expect(tool?.meta).toMatchObject({ name: 'move_lead_stage', allowed: false });
    expect(tool?.reason).toBe('capability_off');
    expect(r.writes).toHaveLength(0); // blocked → executor never recorded it
  });

  it('blocks a write with capability ON but an orphan target (introspect-guard)', async () => {
    const fake = createFakeLlm([
      { text: null, toolCalls: [{ id: '1', name: 'move_lead_stage', args: { stage: 'inexistente' } }] },
      textReply,
    ]);
    const r = await runSimulatorTurn(
      { archetype: 'qualificador', config, capabilities: { can_move_stage: true }, seed: { stages: ['novo'] }, message: 'x' },
      { makeLlm: () => fake },
    );
    const tool = r.trace.steps.find((s) => s.step === 'tool');
    expect(tool?.meta).toMatchObject({ allowed: false });
    expect(tool?.reason).toBe('orphaned_target');
    expect(r.writes).toHaveLength(0);
  });
});

describe('runSimulatorTurn — allowed write recorded as would_execute', () => {
  it('records set_qualification_tier with the real rubric tier, no DB write', async () => {
    const fake = createFakeLlm([
      { text: null, toolCalls: [{ id: '1', name: 'set_qualification_tier', args: { signals: { faturamentoMensal: 50000 } } }] },
      textReply,
    ]);
    const r = await runSimulatorTurn(
      {
        archetype: 'qualificador',
        config,
        capabilities: { can_set_tier: true },
        rubricRules: [{ tier: 'ouro', minFaturamento: 30000 }, { tier: 'bronze' }],
        seed: {},
        message: 'faturo 50k/mês',
      },
      { makeLlm: () => fake },
    );
    expect(r.writes).toHaveLength(1);
    expect(r.writes[0]).toMatchObject({ tool: 'set_qualification_tier', tier: 'ouro' });
    expect(r.trace.result.tier).toBe('ouro');
  });
});
