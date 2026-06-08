/**
 * Situation Catalog for Copilot Follow-up.
 *
 * The Torque-curated defaults — owning Archetype, default trigger delay, and a
 * default cadence (touches + base copy) — for each canonical Follow-up
 * Situation. The Organization enables/disables Situations and tunes basics on
 * top of these defaults; it never authors a Situation from scratch (ADR-0006).
 *
 * Slice 1 ships only proposal_no_reply; the other five Situations land with
 * slices 4/5/6. Final wording is curated under #743 (HITL) — the copy here is a
 * structurally-valid default, not the approved brand copy.
 */

import type { Archetype, SituationId } from "./followup-situations.ts";
import type { CadenceStep } from "./followup-cadence.ts";

export interface SituationDefault {
  situationId: SituationId;
  archetype: Archetype;
  /** Delay from the situation becoming true to the first touch. */
  defaultDelayHours: number;
  defaultDelayMinutes: number;
  /** Default cadence: ordered touches, each with base copy. */
  steps: CadenceStep[];
}

const CATALOG: Partial<Record<SituationId, SituationDefault>> = {
  proposal_no_reply: {
    situationId: "proposal_no_reply",
    archetype: "vendedor",
    defaultDelayHours: 24,
    defaultDelayMinutes: 0,
    steps: [
      {
        order: 1,
        delay_hours: 0,
        delay_minutes: 0,
        style: "direct",
        message_template:
          "Oi {nome}, tudo bem? Passando pra saber se conseguiu ver a proposta que te enviei.",
      },
      {
        order: 2,
        delay_hours: 48,
        delay_minutes: 0,
        style: "value",
        message_template:
          "{nome}, fico à disposição pra ajustar a proposta ao que faz sentido pra {empresa}. Quer que eu revise algum ponto?",
      },
      {
        order: 3,
        delay_hours: 96,
        delay_minutes: 0,
        style: "breakup",
        message_template:
          "{nome}, vou encerrar o acompanhamento por aqui pra não te incomodar. Se quiser retomar, é só me chamar.",
      },
    ],
  },
};

export function getSituationDefault(id: SituationId): SituationDefault {
  const def = CATALOG[id];
  if (!def) {
    throw new Error(`No catalog default for Follow-up Situation: ${id}`);
  }
  return def;
}
