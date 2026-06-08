/**
 * copilot-v2-config — frontend contract mirror for the Slice 8 wizard.
 *
 * The CANONICAL contract lives in the edge module
 * `supabase/functions/_shared/copilot-v2/config-schema.ts`. The frontend build
 * (tsconfig `include: ["src"]`, ESLint boundaries) cannot import from
 * supabase/functions, so the typed-slot constants are re-declared here and a
 * contract-lock test (tests/unit/copilot-v2/fe-edge-contract.test.ts) asserts
 * they never drift from the edge. This module also exposes the Zod schema the
 * wizard's RHF form validates against (mirroring the server validator) and the
 * serializers between wizard state and the save-endpoint payload.
 */

import { z } from "zod";

export type Archetype = "qualificador" | "vendedor" | "carteira";

export const CAPABILITY_FLAGS = [
  "can_move_stage",
  "can_schedule_meeting",
  "can_set_tier",
  "can_fill_field",
  "can_send_media",
  "can_transfer",
  "can_handoff",
] as const;
export type CapabilityFlag = (typeof CAPABILITY_FLAGS)[number];

export const ALLOWED_CAPABILITIES_BY_ARCHETYPE: Record<Archetype, readonly CapabilityFlag[]> = {
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

export const VENDEDOR_OBJECTIVES = ["fechar_conversa", "marcar_reuniao", "apresentar_nutrir", "hibrido"] as const;
export const CARTEIRA_OBJECTIVES = ["recompra", "upsell", "winback", "equilibrado", "onboarding"] as const;
export const CARTEIRA_SEGMENTS = ["ouro", "prata", "novo", "resgate", "dormindo"] as const;

/** Human labels for the dropdowns (value = enum key, label = shown text). */
export const OBJECTIVE_LABELS: Record<string, string> = {
  fechar_conversa: "Fechar na conversa (closer agressivo)",
  marcar_reuniao: "Marcar reunião de fechamento",
  apresentar_nutrir: "Apresentar proposta e nutrir",
  hibrido: "Híbrido: fecha o que dá, escala o resto",
  recompra: "Recompra em foco (ouro/prata)",
  upsell: "Upsell / cross-sell (ouro/prata/novo)",
  winback: "Win-back / resgate (resgate/dormindo)",
  equilibrado: "Relacionamento equilibrado",
  onboarding: "Onboarding de cliente novo",
};

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

// CTO decision: structured dropdown for all 3 archetypes (incl. Personalizado).
export const BUSINESS_HOURS_OPTIONS = [
  "Seg–Sex 08h–18h",
  "Seg–Sex 09h–19h",
  "Seg–Sáb 08h–18h",
  "24/7",
  "Personalizado",
] as const;

export const CARTEIRA_HANDOFF_TARGETS = [
  "Responsável da conta",
  "Time comercial (round-robin)",
  "Vendedor closer específico",
  "Gestor comercial",
] as const;

export const RUBRIC_TIERS = ["diamante", "ouro", "prata", "bronze"] as const;
export const RUBRIC_LEVELS = ["alta", "media", "baixa"] as const;
export const ESCAPE_HATCH_MAX = 500;
export const COMPANY_PARTICULARITIES_MAX = 1000;

/** Per-archetype capabilities are LOCKED in v1 (ADR): the client never edits them.
 * The wizard sends the full whitelist as ON; the server re-derives them anyway. */
export function defaultCapabilitiesFor(archetype: Archetype): Record<CapabilityFlag, boolean> {
  return Object.fromEntries(
    ALLOWED_CAPABILITIES_BY_ARCHETYPE[archetype].map((f) => [f, true]),
  ) as Record<CapabilityFlag, boolean>;
}

// ── Zod form schema (client mirror of the server validator) ──────────────────
const capabilitiesSchema = z
  .object(Object.fromEntries(CAPABILITY_FLAGS.map((f) => [f, z.boolean().optional()])))
  .strict();

export const copilotV2ConfigSchema = z
  .object({
    company: z.object({ name: z.string().optional(), about: z.string().optional() }).strict().optional(),
    products: z.array(z.string()).optional(),
    companyParticularities: z.string().max(COMPANY_PARTICULARITIES_MAX).optional(),
    icp: z.string().optional(),
    objective: z.string().optional(),
    segments: z.array(z.enum(CARTEIRA_SEGMENTS)).optional(),
    objections: z.array(z.string()).optional(),
    socialProof: z.array(z.string()).optional(),
    commercialPolicy: z.string().optional(),
    tone: z.string().optional(),
    businessHours: z.string().optional(),
    handoffTarget: z.string().optional(),
    escapeHatchNotes: z.string().max(ESCAPE_HATCH_MAX).nullable().optional(),
    capabilities: capabilitiesSchema.optional(),
  })
  .strict();

export type CopilotV2Config = z.infer<typeof copilotV2ConfigSchema>;

export interface RubricRule {
  tier: (typeof RUBRIC_TIERS)[number];
  minFaturamento?: number;
  minVolume?: number;
  minRecorrencia?: (typeof RUBRIC_LEVELS)[number];
  minUrgencia?: (typeof RUBRIC_LEVELS)[number];
  requiresIcp?: boolean;
}

export interface SavePayload {
  agentId: string;
  archetype: Archetype;
  config: CopilotV2Config;
  activate: boolean;
  rubricRules?: RubricRule[];
}

/** Builds the save-endpoint payload from wizard state. */
export function toSavePayload(
  agentId: string,
  archetype: Archetype,
  config: CopilotV2Config,
  activate: boolean,
  rubricRules?: RubricRule[],
): SavePayload {
  const payload: SavePayload = { agentId, archetype, config, activate };
  if (archetype === "qualificador" && rubricRules) payload.rubricRules = rubricRules;
  return payload;
}

/**
 * Client-side mirror of the activation gate (server is authoritative on 409).
 * Used only to disable the "Ativar" button + show the missing-checklist.
 */
export function missingHardForActivation(
  archetype: Archetype,
  config: CopilotV2Config,
  rubricRulesCount: number,
): string[] {
  const missing: string[] = [];
  const has = (v?: string | null) => typeof v === "string" && v.trim() !== "";
  if (!has(config.company?.name)) missing.push("company.name");
  if (!has(config.icp)) missing.push("icp");
  if (!config.products || config.products.length === 0) missing.push("products");
  if (!has(config.tone)) missing.push("tone");
  if (!has(config.businessHours)) missing.push("businessHours");
  if (!Object.values(config.capabilities ?? {}).some((v) => v === true)) missing.push("capabilities");
  if (archetype === "qualificador") {
    if (rubricRulesCount === 0) missing.push("rubric");
  } else {
    if (!has(config.objective)) missing.push("objective");
    if (!has(config.commercialPolicy)) missing.push("commercialPolicy");
    if (archetype === "carteira" && !has(config.handoffTarget)) missing.push("handoffTarget");
  }
  return missing;
}
