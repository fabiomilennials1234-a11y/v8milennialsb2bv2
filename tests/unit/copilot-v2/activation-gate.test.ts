/**
 * Slice 8 — activation gate (Copilot v2). Kills v1 audit #29 (the dead gate that
 * let an unconfigured agent go live).
 *
 * An agent may only be activated when it is actually operable: the mandatory
 * identity slots are filled, at least one capability is ON (an agent that can do
 * nothing must never activate — consistent with the fail-CLOSED gate from 1-H),
 * and archetype-specific requirements hold (the Qualificador needs a rubric, or
 * it cannot register the signals it extracts). Soft gaps (tone, hours) warn but
 * don't block. Pure decision.
 */

import { describe, it, expect } from 'vitest';
import { decideActivation } from '../../../supabase/functions/_shared/copilot-v2/activation-gate.ts';
import type { CopilotV2Config } from '../../../supabase/functions/_shared/copilot-v2/config-schema.ts';

const base: CopilotV2Config = {
  company: { name: 'Aço Forte', about: 'x' },
  icp: 'construtoras',
  tone: 'consultivo',
  businessHours: '8h-18h',
  capabilities: { can_move_stage: true },
};

describe('decideActivation — hard requirements (block)', () => {
  it('blocks when company.name is missing', () => {
    const d = decideActivation('vendedor', { ...base, company: { about: 'x' } }, false);
    expect(d.ok).toBe(false);
    expect(d.missingHard).toContain('company.name');
  });

  it('blocks when icp is missing', () => {
    const d = decideActivation('vendedor', { ...base, icp: undefined }, false);
    expect(d.ok).toBe(false);
    expect(d.missingHard).toContain('icp');
  });

  it('blocks when no capability is enabled (agent can do nothing)', () => {
    const d = decideActivation('vendedor', { ...base, capabilities: { can_move_stage: false } }, false);
    expect(d.ok).toBe(false);
    expect(d.missingHard).toContain('capabilities');
  });

  it('blocks a qualificador without a rubric', () => {
    const d = decideActivation('qualificador', base, false);
    expect(d.ok).toBe(false);
    expect(d.missingHard).toContain('rubric');
  });
});

describe('decideActivation — passes when operable', () => {
  it('activates a qualificador with rubric + mandatory slots + a capability', () => {
    expect(decideActivation('qualificador', base, true).ok).toBe(true);
  });

  it('activates a vendedor with mandatory slots + a capability (no rubric needed)', () => {
    expect(decideActivation('vendedor', base, false).ok).toBe(true);
  });

  it('activates a carteira the same way (no rubric, no tier)', () => {
    expect(decideActivation('carteira', base, false).ok).toBe(true);
  });
});

describe('decideActivation — soft warnings (do not block)', () => {
  it('warns on missing tone/businessHours but still activates', () => {
    const d = decideActivation('vendedor', { ...base, tone: undefined, businessHours: undefined }, false);
    expect(d.ok).toBe(true);
    expect(d.missingSoft).toEqual(expect.arrayContaining(['tone', 'businessHours']));
  });
});
