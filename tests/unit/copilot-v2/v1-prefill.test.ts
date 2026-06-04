/**
 * Slice 12 — v1 copilot_agents → v2 wizard prefill (cutover seed).
 *
 * Pure, conservative transform: pick the archetype, seed the high-confidence
 * slots (org name, known business_context keys), translate v1 capability flags
 * onto the v2 per-archetype whitelist, and report what still needs the operator
 * (gaps, via the real activation gate) and what was dropped (no v2 home — never
 * silently lost; serialized into the escape-hatch). It guesses nothing it cannot
 * defend; everything else surfaces as a gap the wizard makes the operator fill.
 */

import { describe, it, expect } from 'vitest';
import { prefillFromV1Agent } from '../../../supabase/functions/_shared/copilot-v2/v1-prefill.ts';

describe('prefillFromV1Agent — archetype + capabilities + gaps', () => {
  it('derives the archetype from the v1 template_type', () => {
    const r = prefillFromV1Agent({ template_type: 'sdr' }, { orgName: 'Milennials' });
    expect(r.archetype).toBe('qualificador');
  });

  it('honors an explicit operator-chosen archetype over the type map', () => {
    const r = prefillFromV1Agent({ template_type: 'sdr' }, { orgName: 'X', archetype: 'carteira' });
    expect(r.archetype).toBe('carteira');
  });

  it('returns a null archetype + archetype gap when the type is unmappable and none chosen', () => {
    const r = prefillFromV1Agent({ template_type: 'custom' }, { orgName: 'X' });
    expect(r.archetype).toBeNull();
    expect(r.gaps).toContain('archetype');
  });

  it('seeds company.name from the org name so it is not a gap', () => {
    const r = prefillFromV1Agent({ template_type: 'qualificador' }, { orgName: 'Milennials' });
    expect(r.config.company?.name).toBe('Milennials');
    expect(r.gaps).not.toContain('company.name');
  });

  it('translates v1 capability flags onto the v2 names', () => {
    const r = prefillFromV1Agent(
      { template_type: 'qualificador', can_schedule_meeting: true, can_transfer_human: true, can_update_crm: true },
      { orgName: 'X' },
    );
    expect(r.config.capabilities.can_schedule_meeting).toBe(true);
    expect(r.config.capabilities.can_transfer).toBe(true);
    expect(r.config.capabilities.can_fill_field).toBe(true);
    expect(r.gaps).not.toContain('capabilities');
  });

  it('drops a v1 capability the target archetype does not allow (no smuggling past the whitelist)', () => {
    // can_qualify_lead → can_set_tier, which carteira may NOT have.
    const r = prefillFromV1Agent(
      { template_type: 'prospectador', can_qualify_lead: true },
      { orgName: 'X', archetype: 'carteira' },
    );
    expect(r.config.capabilities.can_set_tier).toBeUndefined();
    expect(r.dropped.some((d) => d.includes('can_set_tier') || d.includes('can_qualify_lead'))).toBe(true);
  });

  it('drops v1 capabilities with no v2 equivalent', () => {
    const r = prefillFromV1Agent(
      { template_type: 'qualificador', can_answer_faq: true, can_send_followup: true, can_create_lead: true },
      { orgName: 'X' },
    );
    for (const flag of ['can_answer_faq', 'can_send_followup', 'can_create_lead']) {
      expect(r.dropped.some((d) => d.includes(flag))).toBe(true);
    }
  });

  it('reports the real activation gaps for the archetype (vendedor needs objective + commercialPolicy)', () => {
    const r = prefillFromV1Agent({ template_type: 'agendador' }, { orgName: 'X' });
    expect(r.archetype).toBe('vendedor');
    expect(r.gaps).toEqual(expect.arrayContaining(['objective', 'commercialPolicy', 'icp', 'products', 'tone', 'businessHours']));
  });
});

describe('prefillFromV1Agent — escape-hatch + business_context extraction', () => {
  it('serializes v1 fields with no v2 home into the escape-hatch and lists them dropped', () => {
    const r = prefillFromV1Agent(
      {
        template_type: 'qualificador',
        conversation_style: { ritmo: 'rapido', emojis: true },
        few_shot_examples: [{ q: 'oi', a: 'olá' }],
      },
      { orgName: 'X' },
    );
    expect(r.config.escapeHatchNotes).toContain('conversation_style');
    expect(r.config.escapeHatchNotes).toContain('few_shot_examples');
    expect(r.dropped).toEqual(expect.arrayContaining(['conversation_style', 'few_shot_examples']));
  });

  it('never exceeds the escape-hatch limit (truncates with a marker)', () => {
    const r = prefillFromV1Agent(
      { template_type: 'qualificador', conversation_style: 'x'.repeat(2000) },
      { orgName: 'X' },
    );
    expect(r.config.escapeHatchNotes!.length).toBeLessThanOrEqual(500);
    expect(r.config.escapeHatchNotes!.endsWith('…')).toBe(true);
  });

  it('leaves the escape-hatch null when there is nothing v1-only to carry over', () => {
    const r = prefillFromV1Agent({ template_type: 'qualificador' }, { orgName: 'X' });
    expect(r.config.escapeHatchNotes).toBeNull();
  });

  it('seeds known business_context keys (produtos array, icp) onto v2 slots', () => {
    const r = prefillFromV1Agent(
      { template_type: 'qualificador', business_context: { produtos: ['Bomba X', 'Válvula Y'], icp: 'fábricas B2B' } },
      { orgName: 'X' },
    );
    expect(r.config.products).toEqual(['Bomba X', 'Válvula Y']);
    expect(r.config.icp).toBe('fábricas B2B');
    expect(r.gaps).not.toContain('products');
    expect(r.gaps).not.toContain('icp');
  });
});
