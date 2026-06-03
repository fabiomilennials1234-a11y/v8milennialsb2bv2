/**
 * Slice 8 — activation gate (Copilot v2). Kills v1 audit #29.
 *
 * Required-set per the approved design spec (CTO 2026-06-02). An agent activates
 * only when operable: identity slots filled, Section 4 satisfied (rubric for the
 * Qualificador; a chosen objective for Vendedor/Carteira), the authorized
 * price/term source present where the archetype quotes (commercialPolicy for
 * Vendedor & Carteira), a handoff target for Carteira, tone + hours set, and at
 * least one capability ON (fail-CLOSED, consistent with Slice 1-H). Pure.
 */

import { describe, it, expect } from 'vitest';
import { decideActivation } from '../../../supabase/functions/_shared/copilot-v2/activation-gate.ts';
import type { CopilotV2Config } from '../../../supabase/functions/_shared/copilot-v2/config-schema.ts';

const common: CopilotV2Config = {
  company: { name: 'Aço Forte', about: 'x' },
  icp: 'construtoras',
  products: ['Vergalhão'],
  tone: 'consultivo',
  businessHours: 'Seg–Sex 08h–18h',
  capabilities: { can_move_stage: true },
};
const qualificador = (): CopilotV2Config => ({ ...common });
const vendedor = (): CopilotV2Config => ({ ...common, objective: 'fechar_conversa', commercialPolicy: 'sem desconto' });
const carteira = (): CopilotV2Config => ({ ...common, objective: 'recompra', commercialPolicy: 'sem desconto', handoffTarget: 'time comercial' });

describe('decideActivation — common hard requirements', () => {
  it('blocks when company.name is missing', () => {
    const d = decideActivation('vendedor', { ...vendedor(), company: { about: 'x' } }, false);
    expect(d.ok).toBe(false);
    expect(d.missingHard).toContain('company.name');
  });

  it('blocks when icp is missing', () => {
    expect(decideActivation('vendedor', { ...vendedor(), icp: undefined }, false).missingHard).toContain('icp');
  });

  it('blocks when products is empty', () => {
    expect(decideActivation('vendedor', { ...vendedor(), products: [] }, false).missingHard).toContain('products');
  });

  it('blocks when tone or businessHours missing', () => {
    const d = decideActivation('vendedor', { ...vendedor(), tone: undefined, businessHours: undefined }, false);
    expect(d.missingHard).toEqual(expect.arrayContaining(['tone', 'businessHours']));
  });

  it('blocks when no capability is enabled', () => {
    expect(decideActivation('vendedor', { ...vendedor(), capabilities: { can_move_stage: false } }, false).missingHard).toContain('capabilities');
  });
});

describe('decideActivation — Section 4 per archetype', () => {
  it('blocks a qualificador without a rubric', () => {
    expect(decideActivation('qualificador', qualificador(), false).missingHard).toContain('rubric');
  });

  it('blocks a vendedor without an objective', () => {
    expect(decideActivation('vendedor', { ...vendedor(), objective: undefined }, false).missingHard).toContain('objective');
  });

  it('blocks a carteira without an objective', () => {
    expect(decideActivation('carteira', { ...carteira(), objective: undefined }, false).missingHard).toContain('objective');
  });
});

describe('decideActivation — archetype-specific hard requirements', () => {
  it('blocks vendedor & carteira without commercialPolicy', () => {
    expect(decideActivation('vendedor', { ...vendedor(), commercialPolicy: undefined }, false).missingHard).toContain('commercialPolicy');
    expect(decideActivation('carteira', { ...carteira(), commercialPolicy: undefined }, false).missingHard).toContain('commercialPolicy');
  });

  it('does NOT require commercialPolicy for the qualificador', () => {
    expect(decideActivation('qualificador', qualificador(), true).missingHard).not.toContain('commercialPolicy');
  });

  it('blocks carteira without a handoffTarget', () => {
    expect(decideActivation('carteira', { ...carteira(), handoffTarget: undefined }, false).missingHard).toContain('handoffTarget');
  });

  it('does NOT require handoffTarget for vendedor (no handoff token)', () => {
    expect(decideActivation('vendedor', vendedor(), false).missingHard).not.toContain('handoffTarget');
  });
});

describe('decideActivation — passes when fully operable', () => {
  it('activates a qualificador with rubric', () => {
    expect(decideActivation('qualificador', qualificador(), true).ok).toBe(true);
  });
  it('activates a vendedor', () => {
    expect(decideActivation('vendedor', vendedor(), false).ok).toBe(true);
  });
  it('activates a carteira', () => {
    expect(decideActivation('carteira', carteira(), false).ok).toBe(true);
  });
});

describe('decideActivation — soft warnings (do not block)', () => {
  it('warns on missing socialProof but still activates', () => {
    const d = decideActivation('vendedor', vendedor(), false);
    expect(d.ok).toBe(true);
    expect(d.missingSoft).toContain('socialProof');
  });
});
