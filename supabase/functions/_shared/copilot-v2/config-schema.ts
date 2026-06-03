/**
 * config-schema — Copilot v2 strict wizard contract (Slice 8).
 *
 * The single server-side authority for what an operator may persist as agent
 * config. The wizard NEVER edits the prompt (ADR-0002 #4); it fills typed slots.
 * This validator is pure (zero deps — Deno + Vitest safe, same house-style as the
 * sibling decide* guardrails) and enforces, fail-CLOSED:
 *   - STRICT keys: any top-level field outside the typed contract is rejected, so
 *     free text can never be smuggled in beside the escape-hatch.
 *   - NO coercion: a capability value must be a real boolean; 'true' (string) is
 *     rejected, never coerced — this keeps it honest with capability-gate, which
 *     only treats === true as enabled.
 *   - Per-archetype capability WHITELIST: a cap that makes no sense for the
 *     archetype (can_set_tier on carteira; can_handoff on vendedor) cannot be
 *     persisted at all.
 *   - escape-hatch ≤ 500 chars; it lives in its own column, not in the slots blob.
 *
 * The frontend derives its Zod form schema from the exported constants; this
 * module stays the canonical contract the edge enforces.
 */

import type { Archetype } from "./model-selector.ts";
import type { AgentConfig } from "./prompt-builder.ts";
import type { Level, TierRule } from "./rubric-engine.ts";
import { ALL_WRITE_CAPABILITIES } from "./capability-gate.ts";

export const ESCAPE_HATCH_MAX = 500;

/** Contract-locked to the capability-gate's write flags (asserted in tests). */
export const CAPABILITY_FLAGS: readonly string[] = [...ALL_WRITE_CAPABILITIES];

/**
 * Which capabilities an operator may toggle per archetype. Mirrors the base
 * prompts: the Qualificador can do everything incl. handoff to the Vendedor; the
 * Vendedor is terminal (escalates to a human via transfer, never auto-handoffs);
 * the Carteira works by segment and must NEVER set a qualification tier.
 */
export const ALLOWED_CAPABILITIES_BY_ARCHETYPE: Record<Archetype, readonly string[]> = {
  qualificador: [
    "can_move_stage",
    "can_schedule_meeting",
    "can_set_tier",
    "can_fill_field",
    "can_send_media",
    "can_transfer",
    "can_handoff",
  ],
  vendedor: [
    "can_move_stage",
    "can_schedule_meeting",
    "can_set_tier",
    "can_fill_field",
    "can_send_media",
    "can_transfer",
  ],
  carteira: [
    "can_move_stage",
    "can_schedule_meeting",
    "can_fill_field",
    "can_send_media",
    "can_transfer",
    "can_handoff",
  ],
};

// ── Section 4 closed enums (behavior-driving; validated server-side) ──────────
// Qualificador's Section 4 is the rubric (copilot_v2_rubric), NOT an objective.
export const VENDEDOR_OBJECTIVES = [
  "fechar_conversa",
  "marcar_reuniao",
  "apresentar_nutrir",
  "hibrido",
] as const;
export const CARTEIRA_OBJECTIVES = [
  "recompra",
  "upsell",
  "winback",
  "equilibrado",
  "onboarding",
] as const;
export const CARTEIRA_SEGMENTS = ["ouro", "prata", "novo", "resgate", "dormindo"] as const;

const OBJECTIVES_BY_ARCHETYPE: Partial<Record<Archetype, readonly string[]>> = {
  vendedor: VENDEDOR_OBJECTIVES,
  carteira: CARTEIRA_OBJECTIVES,
};

// ── Dropdown option sets the wizard renders (UI-constrained; not hard-validated
// here so a structured "Personalizado" hours value and styling tone stay free). ─
export const TONE_OPTIONS: Record<Archetype, readonly string[]> = {
  qualificador: [
    "Profissional e direto",
    "Consultivo e acolhedor",
    "Técnico e objetivo",
    "Próximo e informal (sem gírias)",
    "Formal e institucional",
  ],
  vendedor: [
    "Consultivo e direto (parceiro de negócio, sem rodeio)",
    "Formal e técnico (especificação, engenharia, compras industriais)",
    "Próximo e caloroso (relacionamento, sempre profissional)",
    "Objetivo e enxuto (comprador ocupado)",
  ],
  carteira: [
    "Parceiro próximo (caloroso, informal-profissional)",
    "Consultivo sóbrio (técnico, direto)",
    "Cordial formal (você, institucional)",
    "Direto e ágil (objetivo, curto)",
  ],
};

export const BUSINESS_HOURS_OPTIONS = [
  "Seg–Sex 08h–18h",
  "Seg–Sex 09h–19h",
  "Seg–Sáb 08h–18h",
  "24/7",
  "Personalizado",
] as const;

export interface CopilotV2Config {
  company?: { name?: string; about?: string };
  products?: string[];
  icp?: string;
  objective?: string;
  segments?: string[];
  objections?: string[];
  socialProof?: string[];
  commercialPolicy?: string;
  tone?: string;
  businessHours?: string;
  handoffTarget?: string;
  escapeHatchNotes?: string | null;
  capabilities: Record<string, boolean>;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  value?: CopilotV2Config;
}

/** Slots blob persisted to copilot_v2_config.slots — escape-hatch excluded. */
export type PersistedSlots = Omit<CopilotV2Config, "escapeHatchNotes">;

const TOP_LEVEL_KEYS = new Set<string>([
  "company",
  "products",
  "icp",
  "objective",
  "segments",
  "objections",
  "socialProof",
  "commercialPolicy",
  "tone",
  "businessHours",
  "handoffTarget",
  "escapeHatchNotes",
  "capabilities",
]);

const SCALAR_STRING_KEYS = ["icp", "commercialPolicy", "tone", "businessHours", "handoffTarget"] as const;
const STRING_LIST_KEYS = ["products", "objections", "socialProof"] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validates a raw config payload for an archetype. Pure, fail-CLOSED, no coercion.
 * Returns every problem found (not just the first) so the UI can surface them.
 */
export function validateConfig(archetype: Archetype, raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(raw)) {
    return { ok: false, errors: ["config must be an object"] };
  }

  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`unknown key: ${key}`);
  }

  if ("company" in raw && raw.company !== undefined) {
    if (!isObject(raw.company)) {
      errors.push("company must be an object");
    } else {
      for (const k of Object.keys(raw.company)) {
        if (k !== "name" && k !== "about") errors.push(`unknown company key: ${k}`);
        else if (raw.company[k] !== undefined && typeof raw.company[k] !== "string") {
          errors.push(`company.${k} must be a string`);
        }
      }
    }
  }

  for (const key of SCALAR_STRING_KEYS) {
    if (key in raw && raw[key] !== undefined && typeof raw[key] !== "string") {
      errors.push(`${key} must be a string`);
    }
  }

  for (const key of STRING_LIST_KEYS) {
    if (key in raw && raw[key] !== undefined) {
      const v = raw[key];
      if (!Array.isArray(v) || v.some((i) => typeof i !== "string")) {
        errors.push(`${key} must be a string[]`);
      }
    }
  }

  // Section 4: objective (vendedor/carteira only) — closed enum.
  if ("objective" in raw && raw.objective !== undefined) {
    const allowed = OBJECTIVES_BY_ARCHETYPE[archetype];
    if (!allowed) {
      errors.push(`objective is not configurable for archetype ${archetype}`);
    } else if (typeof raw.objective !== "string" || !allowed.includes(raw.objective)) {
      errors.push(`objective must be one of: ${allowed.join(", ")}`);
    }
  }

  // Section 4: segments (carteira only) — subset of the known segments.
  if ("segments" in raw && raw.segments !== undefined) {
    if (archetype !== "carteira") {
      errors.push(`segments are only configurable for carteira`);
    } else if (
      !Array.isArray(raw.segments) ||
      raw.segments.some((s) => typeof s !== "string" || !CARTEIRA_SEGMENTS.includes(s as any))
    ) {
      errors.push(`segments must be a subset of: ${CARTEIRA_SEGMENTS.join(", ")}`);
    }
  }

  if ("escapeHatchNotes" in raw && raw.escapeHatchNotes !== undefined && raw.escapeHatchNotes !== null) {
    if (typeof raw.escapeHatchNotes !== "string") {
      errors.push("escapeHatchNotes must be a string or null");
    } else if (raw.escapeHatchNotes.length > ESCAPE_HATCH_MAX) {
      errors.push(`escapeHatchNotes exceeds ${ESCAPE_HATCH_MAX} chars`);
    }
  }

  const allowed = new Set(ALLOWED_CAPABILITIES_BY_ARCHETYPE[archetype]);
  const capabilities: Record<string, boolean> = {};
  if ("capabilities" in raw && raw.capabilities !== undefined) {
    if (!isObject(raw.capabilities)) {
      errors.push("capabilities must be an object");
    } else {
      for (const [flag, val] of Object.entries(raw.capabilities)) {
        if (!CAPABILITY_FLAGS.includes(flag)) {
          errors.push(`unknown capability: ${flag}`);
          continue;
        }
        if (typeof val !== "boolean") {
          errors.push(`capability ${flag} must be a boolean (no coercion)`);
          continue;
        }
        if (val === true && !allowed.has(flag)) {
          errors.push(`capability ${flag} is not allowed for archetype ${archetype}`);
          continue;
        }
        capabilities[flag] = val;
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: CopilotV2Config = { capabilities };
  if (isObject(raw.company)) value.company = { ...(raw.company as { name?: string; about?: string }) };
  for (const key of SCALAR_STRING_KEYS) {
    if (typeof raw[key] === "string") (value as any)[key] = raw[key];
  }
  for (const key of STRING_LIST_KEYS) {
    if (Array.isArray(raw[key])) (value as any)[key] = [...(raw[key] as string[])];
  }
  if (typeof raw.objective === "string") value.objective = raw.objective;
  if (Array.isArray(raw.segments)) value.segments = [...(raw.segments as string[])];
  if ("escapeHatchNotes" in raw) {
    value.escapeHatchNotes = (raw.escapeHatchNotes as string | null) ?? null;
  }

  return { ok: true, errors: [], value };
}

/** Splits a validated config into the slots blob + the escape-hatch column value. */
export function splitForPersistence(config: CopilotV2Config): {
  slots: PersistedSlots;
  escapeHatchNotes: string | null;
} {
  const { escapeHatchNotes, ...slots } = config;
  return { slots, escapeHatchNotes: escapeHatchNotes ?? null };
}

/** Lossless inverse of splitForPersistence — rebuilds the full config for read. */
export function mergeFromPersistence(
  slots: PersistedSlots,
  escapeHatchNotes: string | null,
): CopilotV2Config {
  return { ...slots, escapeHatchNotes };
}

/**
 * Projects the wizard config onto the prompt-builder's AgentConfig (drops
 * capabilities, which the gate reads from slots — not the prompt). This is the
 * single seam between the wizard contract and the ONE prompt-builder.
 */
// ── Rubric (Qualificador Section 4) — TierRule[] for copilot_v2_rubric ────────
export const RUBRIC_TIERS = ["diamante", "ouro", "prata", "bronze"] as const;
export const RUBRIC_LEVELS: readonly Level[] = ["alta", "media", "baixa"];
const RUBRIC_RULE_KEYS = new Set([
  "tier",
  "minFaturamento",
  "minVolume",
  "minRecorrencia",
  "minUrgencia",
  "requiresIcp",
]);

export interface RubricValidationResult {
  ok: boolean;
  errors: string[];
  value?: TierRule[];
}

/**
 * Validates the wizard rubric-form output into TierRule[] the engine reads.
 * Closed tier names (no 'desqualificado' — implicit fallback), numeric floors
 * (no coercion), Level enums, strict keys, no duplicate tier. Pure, fail-CLOSED.
 */
export function validateRubricRules(raw: unknown): RubricValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(raw)) return { ok: false, errors: ["rubric rules must be an array"] };

  const seen = new Set<string>();
  const value: TierRule[] = [];

  raw.forEach((rule, i) => {
    if (!isObject(rule)) {
      errors.push(`rule[${i}] must be an object`);
      return;
    }
    for (const k of Object.keys(rule)) {
      if (!RUBRIC_RULE_KEYS.has(k)) errors.push(`rule[${i}] unknown key: ${k}`);
    }
    const tier = rule.tier;
    if (typeof tier !== "string" || !(RUBRIC_TIERS as readonly string[]).includes(tier)) {
      errors.push(`rule[${i}] tier must be one of: ${RUBRIC_TIERS.join(", ")}`);
      return;
    }
    if (seen.has(tier)) errors.push(`rule[${i}] duplicate tier: ${tier}`);
    seen.add(tier);

    for (const numKey of ["minFaturamento", "minVolume"] as const) {
      if (numKey in rule && rule[numKey] !== undefined) {
        const n = rule[numKey];
        if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
          errors.push(`rule[${i}] ${numKey} must be a non-negative number`);
        }
      }
    }
    for (const lvlKey of ["minRecorrencia", "minUrgencia"] as const) {
      if (lvlKey in rule && rule[lvlKey] !== undefined) {
        if (!RUBRIC_LEVELS.includes(rule[lvlKey] as Level)) {
          errors.push(`rule[${i}] ${lvlKey} must be one of: ${RUBRIC_LEVELS.join(", ")}`);
        }
      }
    }
    if ("requiresIcp" in rule && rule.requiresIcp !== undefined && typeof rule.requiresIcp !== "boolean") {
      errors.push(`rule[${i}] requiresIcp must be a boolean`);
    }

    value.push(rule as unknown as TierRule);
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], value };
}

export function toAgentConfig(config: CopilotV2Config): AgentConfig {
  // Drop the non-prompt metadata: capabilities (read by the gate) + Section-4
  // objective/segments (compiled into specific_notes for carteira at build time).
  const { capabilities: _c, objective: _o, segments: _s, ...agentConfig } = config;
  return agentConfig;
}
