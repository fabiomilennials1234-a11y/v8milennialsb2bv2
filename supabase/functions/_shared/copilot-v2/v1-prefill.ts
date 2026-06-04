/**
 * v1-prefill — Copilot v2 cutover wizard seed (Slice 12).
 *
 * Pure transform from a legacy copilot_agents row to a v2 wizard draft. It is
 * deliberately CONSERVATIVE: it only seeds what it can defend (the org name, a
 * small set of well-known business_context keys, and a v1→v2 capability
 * translation filtered through the per-archetype whitelist). Everything it
 * cannot map with confidence is NOT guessed — it surfaces as a gap (via the real
 * activation gate) for the operator to fill, or as a `dropped` entry serialized
 * into the escape-hatch so no v1 configuration is silently lost.
 *
 * This only seeds the wizard; the operator reviews and explicitly activates.
 */

import type { Archetype } from './model-selector.ts';
import type { CopilotV2Config } from './config-schema.ts';
import { ALLOWED_CAPABILITIES_BY_ARCHETYPE, ESCAPE_HATCH_MAX } from './config-schema.ts';
import { decideActivation } from './activation-gate.ts';
import { mapV1TypeToArchetype } from './v1-archetype-map.ts';

/** Loose shape of a v1 copilot_agents row — every field optional/unknown. */
export interface V1AgentLike {
  template_type?: string;
  name?: string;
  personality?: { tone?: string; style?: string; energy?: string } | null;
  business_context?: Record<string, unknown> | null;
  conversation_style?: unknown;
  few_shot_examples?: unknown;
  qualification_rules?: unknown;
  move_rules?: unknown;
  availability?: unknown;
  operation_mode?: unknown;
  can_qualify_lead?: boolean;
  can_schedule_meeting?: boolean;
  can_send_followup?: boolean;
  can_update_crm?: boolean;
  can_answer_faq?: boolean;
  can_create_lead?: boolean;
  can_transfer_human?: boolean;
}

export interface PrefillOptions {
  orgName?: string;
  /** Operator-chosen archetype — overrides the template_type map. */
  archetype?: Archetype;
}

export interface PrefillResult {
  archetype: Archetype | null;
  config: CopilotV2Config;
  gaps: string[];
  dropped: string[];
}

/** v1 capability flag → v2 capability name (only the defensible translations). */
export const V1_TO_V2_CAPABILITY: Record<string, string> = {
  can_schedule_meeting: 'can_schedule_meeting',
  can_transfer_human: 'can_transfer',
  can_update_crm: 'can_fill_field',
  can_qualify_lead: 'can_set_tier',
};

/** v1 capability flags with no v2 home (prompt/knowledge/runtime concerns now). */
export const V1_UNMAPPED_CAPABILITIES = [
  'can_send_followup',
  'can_answer_faq',
  'can_create_lead',
] as const;

function readString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function readStringList(v: unknown): string[] | undefined {
  if (Array.isArray(v)) {
    const items = v.filter((i): i is string => typeof i === 'string' && i.trim() !== '').map((i) => i.trim());
    return items.length > 0 ? items : undefined;
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const items = v.split(/[\n,;]+/).map((i) => i.trim()).filter((i) => i !== '');
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

function firstDefined<T>(...vals: (T | undefined)[]): T | undefined {
  for (const v of vals) if (v !== undefined) return v;
  return undefined;
}

export function prefillFromV1Agent(v1: V1AgentLike, opts: PrefillOptions = {}): PrefillResult {
  const archetype = opts.archetype ?? mapV1TypeToArchetype(v1.template_type ?? '');

  const dropped: string[] = [];

  // ── Capability translation, filtered through the archetype whitelist ────────
  const capabilities: Record<string, boolean> = {};
  if (archetype) {
    const allowed = new Set(ALLOWED_CAPABILITIES_BY_ARCHETYPE[archetype]);
    for (const [v1flag, v2name] of Object.entries(V1_TO_V2_CAPABILITY)) {
      if ((v1 as Record<string, unknown>)[v1flag] === true) {
        if (allowed.has(v2name)) capabilities[v2name] = true;
        else dropped.push(`capability:${v1flag}→${v2name} (not allowed for ${archetype})`);
      }
    }
  }
  for (const v1flag of V1_UNMAPPED_CAPABILITIES) {
    if ((v1 as Record<string, unknown>)[v1flag] === true) {
      dropped.push(`capability:${v1flag} (no v2 equivalent)`);
    }
  }

  // ── Known business_context keys (conservative; alias the common pt/en names) ─
  const bc = (v1.business_context ?? {}) as Record<string, unknown>;
  const config: CopilotV2Config = { capabilities };

  const companyName = firstDefined(readString(opts.orgName), readString(bc.company), readString(bc.empresa));
  const companyAbout = firstDefined(readString(bc.about), readString(bc.sobre), readString(bc.descricao));
  if (companyName || companyAbout) {
    config.company = {};
    if (companyName) config.company.name = companyName;
    if (companyAbout) config.company.about = companyAbout;
  }

  const icp = firstDefined(readString(bc.icp), readString(bc.ICP), readString(bc.publico_alvo));
  if (icp) config.icp = icp;

  const products = firstDefined(readStringList(bc.products), readStringList(bc.produtos));
  if (products) config.products = products;

  const objections = firstDefined(readStringList(bc.objections), readStringList(bc.objecoes));
  if (objections) config.objections = objections;

  const socialProof = firstDefined(
    readStringList(bc.socialProof),
    readStringList(bc.social_proof),
    readStringList(bc.prova_social),
  );
  if (socialProof) config.socialProof = socialProof;

  const commercialPolicy = firstDefined(
    readString(bc.pricing),
    readString(bc.preco),
    readString(bc.politica_comercial),
  );
  if (commercialPolicy) config.commercialPolicy = commercialPolicy;

  // tone / businessHours / objective / segments / handoffTarget: NOT guessed —
  // left for the operator (surfaced as gaps); v1 personality/availability are
  // preserved in the escape-hatch below for reference.

  // ── Escape-hatch: preserve dropped/lossy v1 context (≤ ESCAPE_HATCH_MAX) ─────
  const { notes, droppedFields } = serializeEscapeHatch(v1);
  dropped.push(...droppedFields);
  config.escapeHatchNotes = notes;

  // ── Gaps: the real activation required-set (rubric never prefilled here) ─────
  let gaps: string[];
  if (!archetype) {
    gaps = ['archetype'];
  } else {
    gaps = decideActivation(archetype, config, /* rubricPresent */ false).missingHard;
  }

  return { archetype, config, gaps, dropped };
}

/**
 * Serializes v1 fields that have NO v2 slot into a compact escape-hatch note
 * (truncated to ESCAPE_HATCH_MAX with a marker) so the operator can review them,
 * and lists which fields were carried over.
 */
function serializeEscapeHatch(v1: V1AgentLike): { notes: string | null; droppedFields: string[] } {
  const parts: string[] = [];
  const droppedFields: string[] = [];

  const add = (label: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string' && value.trim() === '') return;
    if (Array.isArray(value) && value.length === 0) return;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) return;
    const rendered = typeof value === 'string' ? value : JSON.stringify(value);
    parts.push(`${label}: ${rendered}`);
    droppedFields.push(label);
  };

  add('personality', v1.personality);
  add('availability', v1.availability);
  add('operation_mode', v1.operation_mode);
  add('conversation_style', v1.conversation_style);
  add('few_shot_examples', v1.few_shot_examples);
  add('qualification_rules', v1.qualification_rules);
  add('move_rules', v1.move_rules);

  if (parts.length === 0) return { notes: null, droppedFields };

  let notes = `[do v1] ${parts.join(' | ')}`;
  if (notes.length > ESCAPE_HATCH_MAX) {
    notes = notes.slice(0, ESCAPE_HATCH_MAX - 1) + '…';
  }
  return { notes, droppedFields };
}
