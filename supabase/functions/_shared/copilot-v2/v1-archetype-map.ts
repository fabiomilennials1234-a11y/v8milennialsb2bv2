/**
 * v1-archetype-map — Copilot v2 cutover prefill (Slice 12).
 *
 * Pure map from a legacy copilot_agents.template_type to the v2 archetype the
 * wizard should pre-select. This is a SEED only: the operator reviews the routed
 * archetype + the prefilled slots and explicitly activates. We never guess into
 * carteira (net-new post-sale archetype with no v1 equivalent), and ambiguous
 * types fail to `null` so the operator picks rather than the migration inventing
 * a behavior.
 *
 * CTO-approved mapping (2026-06-04):
 *   qualificador → qualificador
 *   sdr          → qualificador
 *   followup     → vendedor
 *   agendador    → vendedor
 *   prospectador → vendedor
 *   custom       → null (manual)
 *   <anything else> → null (manual)
 */

import type { Archetype } from './model-selector.ts';

export type V1AgentType =
  | 'qualificador'
  | 'sdr'
  | 'followup'
  | 'agendador'
  | 'prospectador'
  | 'custom';

/** The closed set of legacy template types, for exhaustiveness checks/tests. */
export const V1_AGENT_TYPES: readonly V1AgentType[] = [
  'qualificador',
  'sdr',
  'followup',
  'agendador',
  'prospectador',
  'custom',
];

export function mapV1TypeToArchetype(type: string): Archetype | null {
  switch (type) {
    case 'qualificador':
    case 'sdr':
      return 'qualificador';
    case 'followup':
    case 'agendador':
    case 'prospectador':
      return 'vendedor';
    // 'custom' and any unrecognized/empty value → operator picks manually.
    default:
      return null;
  }
}
