/**
 * Slice 12b — copilot-v2-prefill edge ⇄ FE wizard contract lock.
 *
 * The prefill endpoint runs the pure prefillFromV1Agent (edge) and the wizard
 * loads its `config` as initialConfig, validating it against the FE zod schema
 * (`.strict()`). This suite locks that contract: the transform's output shape is
 * what the FE PrefillSeed expects, AND the produced config always passes the
 * wizard validator — so a drift in either side fails here, not in the browser.
 */

import { describe, it, expect } from 'vitest';
import { prefillFromV1Agent } from '../../../supabase/functions/_shared/copilot-v2/v1-prefill.ts';
import { copilotV2ConfigSchema } from '../../../src/modules/copilot/lib/copilot-v2-config';

describe('prefill response shape (FE PrefillSeed)', () => {
  it('returns exactly {archetype, config, gaps, dropped}', () => {
    const r = prefillFromV1Agent({ template_type: 'qualificador', can_schedule_meeting: true }, { orgName: 'Acme' });
    expect(Object.keys(r).sort()).toEqual(['archetype', 'config', 'dropped', 'gaps']);
    expect(Array.isArray(r.gaps)).toBe(true);
    expect(Array.isArray(r.dropped)).toBe(true);
    expect(r.config).toBeTypeOf('object');
  });

  it('honors the route archetype override (seed mode passes the route archetype)', () => {
    const r = prefillFromV1Agent({ template_type: 'custom' }, { orgName: 'X', archetype: 'vendedor' });
    expect(r.archetype).toBe('vendedor');
  });
});

describe('prefilled config validates against the FE wizard schema', () => {
  it('a rich qualificador seed parses clean (no extra/invalid slots, strict schema)', () => {
    const r = prefillFromV1Agent(
      {
        template_type: 'qualificador',
        can_schedule_meeting: true,
        can_transfer_human: true,
        can_update_crm: true,
        can_qualify_lead: true,
        business_context: {
          icp: 'construtoras de médio porte',
          products: ['Linha A', 'Linha B'],
          objections: ['preço', 'prazo'],
          pricing: 'tabela sob consulta',
          sobre: 'Distribuidora industrial',
        },
        personality: { tone: 'consultivo', style: 'direto', energy: 'alta' },
        qualification_rules: { min: 3 },
      },
      { orgName: 'Acme Distribuidora' },
    );
    const parsed = copilotV2ConfigSchema.safeParse(r.config);
    expect(parsed.success).toBe(true);
  });

  it('an empty v1 row still yields a schema-valid (mostly-gap) config', () => {
    const r = prefillFromV1Agent({ template_type: 'qualificador' }, { orgName: 'X' });
    expect(copilotV2ConfigSchema.safeParse(r.config).success).toBe(true);
    // company.name seeded from org → not a gap; the rest surfaces for the operator.
    expect(r.gaps).not.toContain('company.name');
    expect(r.gaps.length).toBeGreaterThan(0);
  });

  it('only whitelisted v2 capabilities land in the config (strict capabilities object)', () => {
    const r = prefillFromV1Agent(
      { template_type: 'qualificador', can_schedule_meeting: true, can_send_followup: true },
      { orgName: 'X' },
    );
    // can_send_followup has no v2 home → dropped, never an invalid slot.
    expect(copilotV2ConfigSchema.safeParse(r.config).success).toBe(true);
    expect(r.dropped.some((d) => d.includes('can_send_followup'))).toBe(true);
  });
});
