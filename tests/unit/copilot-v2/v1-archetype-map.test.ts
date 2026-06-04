/**
 * Slice 12 — v1 template_type → v2 archetype prefill map (cutover wizard seed).
 *
 * The 6 legacy copilot_agents types collapse onto the 3 fixed v2 archetypes.
 * CTO-approved mapping: qualificador→qualificador, sdr→qualificador,
 * followup/agendador/prospectador→vendedor, custom→manual (null). carteira is
 * net-new (post-sale) — no v1 type seeds it. Unknown/empty → manual (null).
 * This only SEEDS the wizard; the operator reviews and activates.
 */

import { describe, it, expect } from 'vitest';
import {
  mapV1TypeToArchetype,
  V1_AGENT_TYPES,
} from '../../../supabase/functions/_shared/copilot-v2/v1-archetype-map.ts';

describe('mapV1TypeToArchetype', () => {
  it.each([
    ['qualificador', 'qualificador'],
    ['sdr', 'qualificador'],
    ['followup', 'vendedor'],
    ['agendador', 'vendedor'],
    ['prospectador', 'vendedor'],
  ] as [string, string][])('maps %s → %s', (type, expected) => {
    expect(mapV1TypeToArchetype(type)).toBe(expected);
  });

  it('leaves custom unmapped (operator picks)', () => {
    expect(mapV1TypeToArchetype('custom')).toBeNull();
  });

  it.each([['unknown'], [''], ['QUALIFICADOR']])(
    'leaves %s unmapped (fail to manual, never guess)',
    (type) => {
      expect(mapV1TypeToArchetype(type)).toBeNull();
    },
  );

  it('never seeds carteira from any v1 type (net-new post-sale archetype)', () => {
    const produced = V1_AGENT_TYPES.map(mapV1TypeToArchetype);
    expect(produced).not.toContain('carteira');
  });
});
