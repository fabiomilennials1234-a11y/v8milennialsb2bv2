/**
 * Slice 2 — model-selector (Copilot v2)
 *
 * ADR-0002 #10 previa modelo por arquétipo. Decisão CTO 2026-08-12 unificou os
 * três em openai/gpt-4.1-mini, o mesmo motor do Copilot v1. O enum continua
 * fechado e validado no schema — e o valor antigo do Vendedor
 * (anthropic/claude-sonnet-4-6) já não estava nele desde a migration
 * 20260720221647, então o arquétipo teria quebrado no insert do trace.
 */

import { describe, it, expect } from 'vitest';
import { modelForArchetype } from '../../../supabase/functions/_shared/copilot-v2/model-selector.ts';

describe('modelForArchetype', () => {
  it('usa gpt-4.1-mini nos arquétipos de alto volume', () => {
    expect(modelForArchetype('qualificador')).toBe('openai/gpt-4.1-mini');
    expect(modelForArchetype('carteira')).toBe('openai/gpt-4.1-mini');
  });

  it('usa o mesmo motor no Vendedor — sem modelo mais caro dedicado', () => {
    expect(modelForArchetype('vendedor')).toBe('openai/gpt-4.1-mini');
  });

  it('devolve um valor do enum fechado copilot_v2_model_id', () => {
    // Espelha o enum em prod: gemini-2.5-flash, claude-haiku-4-5, gpt-4.1-mini.
    const valid = ['google/gemini-2.5-flash', 'anthropic/claude-haiku-4-5', 'openai/gpt-4.1-mini'];
    for (const a of ['qualificador', 'vendedor', 'carteira'] as const) {
      expect(valid).toContain(modelForArchetype(a));
    }
  });
});
