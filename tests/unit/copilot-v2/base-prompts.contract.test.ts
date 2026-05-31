/**
 * Slice 2 — base-prompts contract (Copilot v2)
 *
 * Locks the Torque-owned base prompts against regression: they may only
 * reference tools that exist today, only use declared slots, and honor the
 * archetype rules (Vendedor never self-hands-off; Carteira never sets the
 * qualification tier). Also proves prompt-builder fills the REAL prompts with
 * no token left unresolved.
 */

import { describe, it, expect } from 'vitest';
import { BASE_PROMPTS } from '../../../supabase/functions/_shared/copilot-v2/base-prompts.ts';
import { buildSystemPrompt, type AgentConfig } from '../../../supabase/functions/_shared/copilot-v2/prompt-builder.ts';

const ARCHETYPES = ['qualificador', 'vendedor', 'carteira'] as const;

const FORBIDDEN_TOOLS = ['build_quote', 'get_product_pricing', 'propose_payment_terms', 'remember_lead_fact', 'get_reorder_forecast'];
const ALLOWED_PLACEHOLDERS = new Set([
  'company_name', 'company_about', 'products', 'icp', 'objections', 'social_proof',
  'commercial_policy', 'tone', 'business_hours', 'handoff_target', 'specific_notes',
]);

const fullConfig: AgentConfig = {
  company: { name: 'Aços Brasil', about: 'distribuidora B2B' },
  products: ['Vergalhão', 'Tubo'],
  icp: 'indústrias do Sudeste',
  objections: ['preço', 'prazo'],
  socialProof: ['+200 clientes'],
  commercialPolicy: 'desconto até 10%',
  tone: 'formal',
  businessHours: 'seg-sex 8h-18h',
  handoffTarget: 'time comercial',
  escapeHatchNotes: 'preferimos boleto',
};

describe('base-prompts contract', () => {
  it.each(ARCHETYPES)('%s exists and is substantial', (a) => {
    expect(BASE_PROMPTS[a]).toBeTruthy();
    expect(BASE_PROMPTS[a].length).toBeGreaterThan(1000);
  });

  it.each(ARCHETYPES)('%s references no future-wave (forbidden) tool', (a) => {
    for (const tool of FORBIDDEN_TOOLS) {
      expect(BASE_PROMPTS[a]).not.toContain(tool);
    }
  });

  it.each(ARCHETYPES)('%s only uses declared slot placeholders', (a) => {
    const tokens = [...BASE_PROMPTS[a].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    const bad = tokens.filter((t) => !ALLOWED_PLACEHOLDERS.has(t));
    expect(bad).toEqual([]);
  });

  it.each(ARCHETYPES)('%s fills with no unresolved slot token via prompt-builder', (a) => {
    const out = buildSystemPrompt(a, fullConfig, BASE_PROMPTS);
    // No real slot token ({{word}}) may remain. Illustrative prose like "({{...}})"
    // is not a slot (dots aren't \w) and is left as-is by design.
    expect(out).not.toMatch(/\{\{\w+\}\}/);
    expect(out).toContain('Aços Brasil');
  });

  it('Vendedor never hands off to itself (escalates via transfer_to_human only)', () => {
    expect(BASE_PROMPTS.vendedor).not.toContain('handoff_to_vendedor');
  });

  it('Carteira explicitly forbids set_qualification_tier (uses segment, not tier — ADR #3)', () => {
    expect(BASE_PROMPTS.carteira).toMatch(/NUNCA.*set_qualification_tier/);
  });

  it('Qualificador legitimately uses set_qualification_tier (extracts signals)', () => {
    expect(BASE_PROMPTS.qualificador).toContain('set_qualification_tier');
  });
});
