/**
 * prompt-builder — Copilot v2 strict config contract (Slice 2/8).
 *
 * The base prompt per archetype is Torque-owned and IMMUTABLE; the client only
 * fills typed slots. This module substitutes the {{slot}} tokens of the base
 * template with the client's config values. It never lets the client edit the
 * skeleton — config is data, the structure is fixed. The escape-hatch
 * subordination framing lives in the base template text (around
 * {{specific_notes}}); the builder only injects the value.
 */

import type { Archetype } from "./model-selector.ts";

export interface AgentConfig {
  company?: { name?: string; about?: string };
  products?: string[];
  companyParticularities?: string;
  icp?: string;
  objections?: string[];
  socialProof?: string[];
  commercialPolicy?: string;
  tone?: string;
  businessHours?: string;
  handoffTarget?: string;
  escapeHatchNotes?: string | null;
}

const MISSING = "(não configurado)";

function list(items: string[] | undefined): string | undefined {
  if (!items || items.length === 0) return undefined;
  return items.map((i) => `- ${i}`).join("\n");
}

/** Maps the typed config to the flat slot map the base templates expect. */
export function configToSlots(config: AgentConfig): Record<string, string | undefined> {
  return {
    company_name: config.company?.name,
    company_about: config.company?.about,
    products: list(config.products),
    company_particularities: config.companyParticularities,
    icp: config.icp,
    objections: list(config.objections),
    social_proof: list(config.socialProof),
    commercial_policy: config.commercialPolicy,
    tone: config.tone,
    business_hours: config.businessHours,
    handoff_target: config.handoffTarget,
    specific_notes: config.escapeHatchNotes ?? undefined,
  };
}

/**
 * Fills every {{token}} in the template from `slots`. Missing/blank slots become
 * a neutral marker — no token is ever left unresolved, and values are inserted
 * verbatim as data (no re-templating / injection).
 */
export function fillTemplate(template: string, slots: Record<string, string | undefined>): string {
  return template.replace(/\{\{([\w-]+)\}\}/g, (_match, key: string) => {
    const value = slots[key];
    return value && value.trim() !== "" ? value : MISSING;
  });
}

/**
 * Builds the final system prompt for an archetype from its immutable base
 * template + the client config. `basePrompts` is injectable for testing; the
 * edge passes the real Torque-owned BASE_PROMPTS.
 */
export function buildSystemPrompt(
  archetype: Archetype,
  config: AgentConfig,
  basePrompts: Record<string, string>,
): string {
  const base = basePrompts[archetype];
  if (!base) throw new Error(`unknown archetype: ${archetype}`);
  return fillTemplate(base, configToSlots(config));
}
