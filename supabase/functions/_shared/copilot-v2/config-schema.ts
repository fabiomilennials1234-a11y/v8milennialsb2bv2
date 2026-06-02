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

export interface CopilotV2Config {
  company?: { name?: string; about?: string };
  products?: string[];
  icp?: string;
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
export function toAgentConfig(config: CopilotV2Config): AgentConfig {
  const { capabilities: _capabilities, ...agentConfig } = config;
  return agentConfig;
}
