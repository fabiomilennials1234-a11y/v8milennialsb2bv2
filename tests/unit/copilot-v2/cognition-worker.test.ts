/**
 * Slice 2/10 — cognition-worker wiring (Copilot v2)
 *
 * handleQueuedMessage ties the spine together: contact-status → archetype →
 * per-archetype model → immutable base prompt filled with config → tool-loop
 * with the cumulative gates. Tested end-to-end with fakes (no LLM keys, no DB):
 * a captured LLM factory proves the right model + the right base prompt reach
 * the loop, and a contact whose archetype isn't enabled is deferred.
 */

import { describe, it, expect } from 'vitest';
import { handleQueuedMessage, type ResolvedContext } from '../../../supabase/functions/_shared/copilot-v2/cognition-worker.ts';
import type { LlmResponse, LlmClient } from '../../../supabase/functions/_shared/copilot-v2/cognition-loop.ts';
import type { ModelId } from '../../../supabase/functions/_shared/copilot-v2/model-selector.ts';
import type { AgentConfig } from '../../../supabase/functions/_shared/copilot-v2/prompt-builder.ts';

const cfg: AgentConfig = { company: { name: 'Aços Brasil' }, tone: 'formal' };

function ctx(overrides: Partial<ResolvedContext> = {}): ResolvedContext {
  return {
    contactStatus: 'NOVO',
    activeArchetypes: new Set(['qualificador', 'vendedor', 'carteira']),
    configByArchetype: { qualificador: cfg, vendedor: cfg, carteira: cfg },
    capabilitiesByArchetype: {
      qualificador: { can_move_stage: true },
      vendedor: { can_move_stage: true },
      carteira: { can_move_stage: true },
    },
    introspection: { stages: ['abordado'], fields: [] },
    ...overrides,
  };
}

/** Captures the model it was built with + the system prompt it received. */
function captureLlm(response: LlmResponse) {
  const captured: { model?: ModelId; system?: string } = {};
  const makeLlm = (model: ModelId): LlmClient => {
    captured.model = model;
    return { async complete(input) { captured.system = input.system; return response; } };
  };
  return { makeLlm, captured };
}

const reply: LlmResponse = { text: 'olá!', toolCalls: [] };
const baseInput = { message: { content: 'oi', canonicalPhone: '11987654321' }, toolSchemas: [], executeTool: async () => ({}) };

describe('handleQueuedMessage — routing + model + prompt wiring', () => {
  it('routes a NEW contact to Qualificador on a Flash-class model', async () => {
    const { makeLlm, captured } = captureLlm(reply);
    const out = await handleQueuedMessage({ ...baseInput, context: ctx({ contactStatus: 'NOVO' }), makeLlm });
    expect(out).toMatchObject({ handled: true, archetype: 'qualificador', model: 'google/gemini-2.5-flash' });
    expect(captured.model).toBe('google/gemini-2.5-flash');
    expect(captured.system).toContain('QUALIFICADOR');
  });

  it('routes a QUALIFIED contact to Vendedor on a Sonnet-class model', async () => {
    const { makeLlm, captured } = captureLlm(reply);
    const out = await handleQueuedMessage({ ...baseInput, context: ctx({ contactStatus: 'QUALIFIED' }), makeLlm });
    expect(out).toMatchObject({ handled: true, archetype: 'vendedor', model: 'anthropic/claude-sonnet-4-6' });
    expect(captured.model).toBe('anthropic/claude-sonnet-4-6');
  });

  it('routes a portfolio customer to Carteira', async () => {
    const { makeLlm, captured } = captureLlm(reply);
    const out = await handleQueuedMessage({ ...baseInput, context: ctx({ contactStatus: 'CLIENTE_CARTEIRA' }), makeLlm });
    expect(out).toMatchObject({ handled: true, archetype: 'carteira' });
    expect(captured.system).toContain('CARTEIRA');
  });

  it('defers when the routed archetype is not enabled for the org', async () => {
    const { makeLlm } = captureLlm(reply);
    const out = await handleQueuedMessage({
      ...baseInput,
      context: ctx({ contactStatus: 'CLIENTE_CARTEIRA', activeArchetypes: new Set(['qualificador']) }),
      makeLlm,
    });
    expect(out).toEqual({ handled: false, reason: 'no_active_archetype', archetype: 'carteira' });
  });

  it('fills the base prompt with the org config (no unresolved slot)', async () => {
    const { makeLlm, captured } = captureLlm(reply);
    await handleQueuedMessage({ ...baseInput, context: ctx(), makeLlm });
    expect(captured.system).toContain('Aços Brasil');
    expect(captured.system).not.toMatch(/\{\{\w+\}\}/);
  });

  it('passes capabilities through to the loop (a write with capability off is blocked)', async () => {
    const { makeLlm } = captureLlm({ text: null, toolCalls: [{ id: '1', name: 'move_lead_stage', args: { stage: 'abordado' } }] });
    let executed = false;
    const out = await handleQueuedMessage({
      ...baseInput,
      context: ctx({ capabilitiesByArchetype: { qualificador: { can_move_stage: false }, vendedor: {}, carteira: {} } }),
      makeLlm,
      executeTool: async () => { executed = true; return {}; },
      writeTargetOf: (_n, a) => a.stage as string,
    });
    expect(executed).toBe(false);
    if (out.handled) expect(out.steps[0]).toMatchObject({ name: 'move_lead_stage', allowed: false, reason: 'capability_off' });
  });
});
