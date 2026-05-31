/**
 * contact-status — Copilot v2 deterministic routing (Slice 10, ADR #1).
 *
 * The status comes from a DB-backed read (get_contact_status by canonical
 * phone). THIS is the pure decision: status → archetype. Replaces v1's complex
 * per-agent routing_stages/origins/segments.
 */

import type { Archetype } from "./model-selector.ts";

export type ContactStatus = "NOVO" | "LEAD_NO_PIPELINE" | "QUALIFIED" | "CLIENTE_CARTEIRA";

export function routeArchetype(status: ContactStatus): Archetype {
  switch (status) {
    case "NOVO":
    case "LEAD_NO_PIPELINE":
      return "qualificador";
    case "QUALIFIED":
      return "vendedor";
    case "CLIENTE_CARTEIRA":
      return "carteira";
    default: {
      // Exhaustiveness guard — a new status must be routed explicitly.
      const _never: never = status;
      throw new Error(`unrouted contact status: ${_never}`);
    }
  }
}
