/**
 * Slice 7 — threshold RAG centralizado (Copilot v2)
 *
 * A v1 tinha 3 thresholds divergentes pro mesmo conceito (doc 0.5/0.55/0.6).
 * Consolidado num módulo único, ajustável num lugar só, com defaults expostos.
 */
import { describe, it, expect } from 'vitest';
import { RAG_THRESHOLDS, resolveThreshold } from '../../../supabase/functions/_shared/copilot-v2/rag-threshold.ts';

describe('RAG_THRESHOLDS — fonte única', () => {
  it('expõe os 3 thresholds consolidados', () => {
    expect(RAG_THRESHOLDS).toEqual({ doc: 0.55, faq: 0.5, memory: 0.7 });
  });
  it('resolveThreshold devolve o default por kind', () => {
    expect(resolveThreshold('doc')).toBe(0.55);
    expect(resolveThreshold('faq')).toBe(0.5);
    expect(resolveThreshold('memory')).toBe(0.7);
  });
  it('resolveThreshold respeita um override válido (tuning sem editar o módulo)', () => {
    expect(resolveThreshold('doc', 0.7)).toBe(0.7);
  });
  it('ignora override fora de [0,1] (fail-safe pro default)', () => {
    expect(resolveThreshold('doc', 1.5)).toBe(0.55);
    expect(resolveThreshold('doc', -1)).toBe(0.55);
  });
});
