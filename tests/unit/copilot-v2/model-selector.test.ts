/**
 * Slice 2 — model-selector (Copilot v2)
 *
 * ADR-0002 #10: per-archetype model. Fast tool-calling model (Flash-class) for
 * high-volume Qualificador/Carteira; a stronger model (Sonnet-class) for
 * Vendedor's closing nuance. Closed enum (validated in the schema).
 */

import { describe, it, expect } from 'vitest';
import { modelForArchetype } from '../../../supabase/functions/_shared/copilot-v2/model-selector.ts';

describe('modelForArchetype', () => {
  it('uses a Flash-class model for high-volume archetypes', () => {
    expect(modelForArchetype('qualificador')).toBe('google/gemini-2.5-flash');
    expect(modelForArchetype('carteira')).toBe('google/gemini-2.5-flash');
  });

  it('uses a stronger (Sonnet-class) model for Vendedor', () => {
    expect(modelForArchetype('vendedor')).toBe('anthropic/claude-sonnet-4-6');
  });

  it('returns a value from the closed model enum', () => {
    const valid = ['google/gemini-2.5-flash', 'anthropic/claude-haiku-4-5', 'anthropic/claude-sonnet-4-6'];
    for (const a of ['qualificador', 'vendedor', 'carteira'] as const) {
      expect(valid).toContain(modelForArchetype(a));
    }
  });
});
