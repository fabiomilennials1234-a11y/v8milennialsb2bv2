/**
 * Slice 10 — contact-status routing (Copilot v2, ADR #1)
 *
 * Deterministic routing by contact status → archetype. Replaces v1's complex
 * per-agent routing_stages/origins/segments. The status itself comes from a
 * DB-backed read (get_contact_status); THIS is the pure routing decision.
 */

import { describe, it, expect } from 'vitest';
import { routeArchetype, type ContactStatus } from '../../../supabase/functions/_shared/copilot-v2/contact-status.ts';

describe('routeArchetype', () => {
  it.each([
    ['NOVO', 'qualificador'],
    ['LEAD_NO_PIPELINE', 'qualificador'],
    ['QUALIFIED', 'vendedor'],
    ['CLIENTE_CARTEIRA', 'carteira'],
  ] as [ContactStatus, string][])('routes %s → %s', (status, expected) => {
    expect(routeArchetype(status)).toBe(expected);
  });
});
