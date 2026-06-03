/**
 * Slice 8 — wizard ⇄ prompt-builder contract (Copilot v2). Kills v1 #30/#31
 * (two divergent builders): there is ONE builder and the wizard config feeds it
 * exactly. This test binds the config-schema output to the single
 * configToSlots/buildSystemPrompt path and proves there are no orphan tokens
 * (a {{slot}} with no schema field) and no orphan fields (a schema slot no base
 * prompt consumes). A saved config must always render a complete system prompt.
 */

import { describe, it, expect } from 'vitest';
import { BASE_PROMPTS } from '../../../supabase/functions/_shared/copilot-v2/base-prompts.ts';
import { buildSystemPrompt, configToSlots } from '../../../supabase/functions/_shared/copilot-v2/prompt-builder.ts';
import { validateConfig, toAgentConfig } from '../../../supabase/functions/_shared/copilot-v2/config-schema.ts';
import type { Archetype } from '../../../supabase/functions/_shared/copilot-v2/model-selector.ts';

const ARCHETYPES: Archetype[] = ['qualificador', 'vendedor', 'carteira'];

const fullRaw = {
  company: { name: 'Aço Forte', about: 'Distribuidora de aço B2B' },
  products: ['Vergalhão'],
  icp: 'Construtoras',
  objections: ['preço'],
  socialProof: ['500 obras'],
  commercialPolicy: 'Sem desconto > 5%',
  tone: 'consultivo',
  businessHours: '8h-18h',
  handoffTarget: 'comercial',
  escapeHatchNotes: 'Foco em volume.',
  capabilities: { can_move_stage: true },
};

function tokensOf(template: string): string[] {
  return [...template.matchAll(/\{\{([\w-]+)\}\}/g)].map((m) => m[1]);
}

describe('wizard config → system prompt', () => {
  it('leaves ZERO unresolved tokens for every archetype', () => {
    const { value } = validateConfig('qualificador', fullRaw);
    for (const arch of ARCHETYPES) {
      const prompt = buildSystemPrompt(arch, toAgentConfig(value!), BASE_PROMPTS);
      expect(prompt).not.toMatch(/\{\{[\w-]+\}\}/);
    }
  });

  it('renders the neutral marker for gaps, never a raw token', () => {
    const { value } = validateConfig('vendedor', { company: { name: 'X' }, capabilities: { can_move_stage: true } });
    const prompt = buildSystemPrompt('vendedor', toAgentConfig(value!), BASE_PROMPTS);
    expect(prompt).not.toMatch(/\{\{[\w-]+\}\}/);
    expect(prompt).toContain('(não configurado)');
  });

  it('injects escapeHatchNotes verbatim at the specific_notes slot', () => {
    const { value } = validateConfig('qualificador', fullRaw);
    const prompt = buildSystemPrompt('qualificador', toAgentConfig(value!), BASE_PROMPTS);
    expect(prompt).toContain('Foco em volume.');
  });
});

describe('contract integrity (no orphan token, no orphan field)', () => {
  const slotKeys = new Set(Object.keys(configToSlots({})));

  it('every base-prompt token has a corresponding slot key', () => {
    for (const arch of ARCHETYPES) {
      for (const tok of tokensOf(BASE_PROMPTS[arch])) {
        expect(slotKeys.has(tok)).toBe(true);
      }
    }
  });

  it('every slot key is consumed by at least one base prompt (union)', () => {
    const used = new Set<string>();
    for (const arch of ARCHETYPES) tokensOf(BASE_PROMPTS[arch]).forEach((t) => used.add(t));
    for (const key of slotKeys) expect(used.has(key)).toBe(true);
  });
});
