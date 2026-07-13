/**
 * Zod schema for the declarative workflow spec (docs/adr/0013). Makes it impossible to
 * compile an ill-formed spec. Tiered config validation: graph-relevant fields + the
 * high-frequency action configs are enforced; the long tail of actions is accepted with a
 * known actionType + passthrough config (mirrors the frontend's permissive ActionNodeData).
 *
 * NB: discriminatedUnion options MUST be plain ZodObjects (no .superRefine — that yields a
 * ZodEffects and breaks discriminator routing). So the tiered/refinement checks live in a
 * single recursive superRefine on the whole spec, which also gives precise issue paths.
 */
import { z } from "zod";
import { ACTION_TYPE_SET, TRIGGER_TYPE_SET } from "./enums.ts";
import type { DeclSpec, Step } from "./dsl.ts";

const cfg = z.record(z.unknown());

// Tiered: required-config checks for curated, high-frequency actions → error string | null.
const CURATED_ACTION_CHECK: Record<string, (c: Record<string, unknown>) => string | null> = {
  send_whatsapp: (c) =>
    c.messageTemplate || c.templateId
      ? null
      : "send_whatsapp requires messageTemplate or templateId",
  send_whatsapp_template: (
    c,
  ) => (c.templateId ? null : "send_whatsapp_template requires templateId"),
  send_whatsapp_document: (c) =>
    c.documentUrl ? null : "send_whatsapp_document requires documentUrl",
  send_to_number: (c) => {
    const phones = Array.isArray(c.notifyPhones)
      ? c.notifyPhones.filter((p) => typeof p === "string" && p.trim())
      : [];
    if (phones.length === 0) return "send_to_number requires at least one notifyPhones entry";
    if (!c.messageTemplate) return "send_to_number requires messageTemplate";
    return null;
  },
  move_stage: (c) => (c.targetStage ? null : "move_stage requires targetStage"),
  add_tag: (c) => (c.tagId || c.tagName ? null : "add_tag requires tagId or tagName"),
  remove_tag: (c) => (c.tagId || c.tagName ? null : "remove_tag requires tagId or tagName"),
  update_lead_field: (c) => (c.fieldName ? null : "update_lead_field requires fieldName"),
  create_followup: (c) => (c.followupTitle ? null : "create_followup requires followupTitle"),
  add_to_campaign: (c) =>
    c.campaignId || c.campaignName ? null : "add_to_campaign requires campaignId or campaignName",
  generate_ai_message: (c) => (c.aiAgentId ? null : "generate_ai_message requires aiAgentId"),
};

const triggerSchema = z.object({
  type: z.string().refine((t) => TRIGGER_TYPE_SET.has(t), { message: "unknown trigger type" }),
  config: cfg.optional(),
});

// Recursive step union (z.lazy). Options are plain objects — refinements happen in the
// spec-level superRefine below.
const stepSchema: z.ZodType<Step> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("action"),
      actionType: z.string().refine((a) => ACTION_TYPE_SET.has(a), {
        message: "unknown action type",
      }),
      label: z.string().optional(),
      config: cfg.optional(),
      ref: z.string().optional(),
      onError: z.array(stepSchema).optional(),
    }),
    z.object({
      kind: z.literal("delay"),
      amount: z.number().positive(),
      unit: z.enum(["seconds", "minutes", "hours", "days"]),
      label: z.string().optional(),
      ref: z.string().optional(),
    }),
    z.object({
      kind: z.literal("condition"),
      field: z.string().min(1),
      operator: z.string().min(1),
      value: z.unknown().optional(),
      label: z.string().optional(),
      ref: z.string().optional(),
      then: z.array(stepSchema),
      else: z.array(stepSchema).optional(),
    }),
    z.object({
      kind: z.literal("wait_response"),
      timeoutHours: z.number().nonnegative().optional(),
      timeoutMinutes: z.number().nonnegative().optional(),
      channel: z.enum(["whatsapp", "meta", "any"]).optional(),
      label: z.string().optional(),
      ref: z.string().optional(),
      replied: z.array(stepSchema),
      timeout: z.array(stepSchema),
    }),
    z.object({
      kind: z.literal("split"),
      variants: z.array(
        z.object({
          label: z.string().min(1),
          weight: z.number().positive(),
          steps: z.array(stepSchema),
        }),
      ).min(2),
      label: z.string().optional(),
      ref: z.string().optional(),
    }),
    z.object({
      kind: z.literal("copilot"),
      agentId: z.string().min(1),
      label: z.string().optional(),
      ref: z.string().optional(),
    }),
    z.object({
      kind: z.literal("assign_responsible"),
      assignMode: z.enum(["round_robin", "random", "manual"]),
      assignTarget: z.enum(["responsible", "sdr", "closer", "sale"]),
      assigneeId: z.string().optional(),
      label: z.string().optional(),
      ref: z.string().optional(),
    }),
    z.object({
      kind: z.literal("webhook_call"),
      url: z.string().url(),
      method: z.string().min(1),
      label: z.string().optional(),
      ref: z.string().optional(),
    }),
    z.object({
      kind: z.literal("wait_business_window"),
      config: cfg.optional(),
      label: z.string().optional(),
      ref: z.string().optional(),
    }),
    // NB: "goto" is reserved in the DSL types but NOT accepted in v1 (the compiler does not
    // emit cross-jumps yet) — keeping schema and compiler in lockstep. Deferred per ADR 0013.
    z.object({ kind: z.literal("end"), label: z.string().optional() }),
  ])
);

// deno-lint-ignore no-explicit-any
function refineSteps(steps: any[], ctx: z.RefinementCtx, path: (string | number)[]): void {
  steps.forEach((s, i) => {
    const at = [...path, i];
    if (s.kind === "action") {
      const check = CURATED_ACTION_CHECK[s.actionType];
      if (check) {
        const msg = check(s.config ?? {});
        if (msg) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg, path: [...at, "config"] });
        }
      }
      if (Array.isArray(s.onError)) refineSteps(s.onError, ctx, [...at, "onError"]);
    } else if (s.kind === "condition") {
      refineSteps(s.then, ctx, [...at, "then"]);
      if (Array.isArray(s.else)) refineSteps(s.else, ctx, [...at, "else"]);
    } else if (s.kind === "wait_response") {
      refineSteps(s.replied, ctx, [...at, "replied"]);
      refineSteps(s.timeout, ctx, [...at, "timeout"]);
    } else if (s.kind === "split") {
      const sum = s.variants.reduce((a: number, v: { weight: number }) => a + v.weight, 0);
      if (sum !== 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `split variant weights must sum to 100 (got ${sum})`,
          path: [...at, "variants"],
        });
      }
      s.variants.forEach((v: { steps: unknown[] }, vi: number) =>
        refineSteps(v.steps as unknown[], ctx, [...at, "variants", vi, "steps"])
      );
    }
  });
}

export const specSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  loop_limit: z.number().int().positive().optional(),
  trigger: triggerSchema,
  steps: z.array(stepSchema).min(1),
}).superRefine((spec, ctx) => refineSteps(spec.steps as unknown[], ctx, ["steps"]));

/** Parse + structurally validate an untrusted declarative spec. Throws ZodError on invalid. */
export function parseSpec(input: unknown): DeclSpec {
  return specSchema.parse(input) as DeclSpec;
}

/** Non-throwing variant — returns { ok, data?|errors? }. */
export function safeParseSpec(
  input: unknown,
): { ok: true; data: DeclSpec } | { ok: false; errors: string[] } {
  const r = specSchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data as DeclSpec };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
}
