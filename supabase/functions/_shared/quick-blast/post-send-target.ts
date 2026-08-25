/**
 * post-send-target — the Disparos "Destino" contract (post-send lead move).
 *
 * A Blast Plan may carry a post_send_target: each recipient is moved to a
 * chosen funnel stage AT THE MOMENT its message is sent (per lot — plans drain
 * over days, so the move is per-lead, never all at once).
 *
 *   parsePostSendTarget    — pure shape validation of the untrusted payload.
 *   validatePostSendTarget — FAIL-CLOSED existence check against the org's own
 *     stages (system: pipeline_stages by pipeline_type + is_active; custom:
 *     custom_pipeline_stages by id + pipeline_id + org). An invalid target is a
 *     400 at create time — a plan is never persisted with a broken target.
 *   buildPostSendMover     — the injected `onRecipientsSent` dep: moves each
 *     sent lead via the canonical moveStage motor (system pipes through
 *     upsertPipeEntry, custom through custom_pipe_entries). BEST-EFFORT: a
 *     per-lead failure is logged and skipped; it never throws — the lead
 *     already received the message, the send must not fail because of the move.
 *
 * Multi-tenancy: the org id ALWAYS comes from the plan's own organization_id
 * (or the caller's resolved org at create time) — never from the payload.
 */
// deno-lint-ignore-file no-explicit-any
import { moveStage } from "../action-handlers/move-stage.ts";

export interface PostSendTarget {
  funnelKind: "system" | "custom";
  /** System pipe when funnelKind === "system". */
  pipelineType?: "whatsapp" | "confirmacao" | "propostas";
  /** Custom pipeline id when funnelKind === "custom". */
  pipelineId?: string;
  /** system: stage_key slug; custom: custom_pipeline_stages.id uuid. */
  stageKey: string;
  /** Human label for panel display only — never used for routing. */
  label: string;
}

const SYSTEM_PIPES = ["whatsapp", "confirmacao", "propostas"] as const;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParseResult =
  | { ok: true; target: PostSendTarget }
  | { ok: false; error: string };

/** Pure shape check of the untrusted post_send_target payload (fail-closed). */
export function parsePostSendTarget(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "post_send_target_invalid" };
  }
  const t = raw as Record<string, unknown>;

  const stageKey = typeof t.stageKey === "string" ? t.stageKey.trim() : "";
  if (!stageKey) return { ok: false, error: "post_send_target_missing_stage" };
  const label = typeof t.label === "string" ? t.label.trim() : "";

  if (t.funnelKind === "system") {
    const pipelineType = t.pipelineType;
    if (!SYSTEM_PIPES.includes(pipelineType as any)) {
      return { ok: false, error: "post_send_target_invalid_pipeline_type" };
    }
    return {
      ok: true,
      target: {
        funnelKind: "system",
        pipelineType: pipelineType as PostSendTarget["pipelineType"],
        stageKey,
        label,
      },
    };
  }

  if (t.funnelKind === "custom") {
    const pipelineId = typeof t.pipelineId === "string" ? t.pipelineId : "";
    if (!UUID_RE.test(pipelineId)) {
      return { ok: false, error: "post_send_target_invalid_pipeline_id" };
    }
    if (!UUID_RE.test(stageKey)) {
      return { ok: false, error: "post_send_target_invalid_stage_id" };
    }
    return {
      ok: true,
      target: { funnelKind: "custom", pipelineId, stageKey, label },
    };
  }

  return { ok: false, error: "post_send_target_invalid_funnel_kind" };
}

/**
 * FAIL-CLOSED validation: shape + the destination stage must exist in the
 * caller org. Any miss (foreign org, inactive/renamed stage, wrong pipeline)
 * rejects — a plan is never persisted pointing at a broken destination.
 */
export async function validatePostSendTarget(
  supabase: any,
  orgId: string,
  raw: unknown,
): Promise<ParseResult> {
  const parsed = parsePostSendTarget(raw);
  if (!parsed.ok) return parsed;
  const target = parsed.target;

  if (target.funnelKind === "system") {
    const { data, error } = await supabase
      .from("pipeline_stages")
      .select("stage_key")
      .eq("organization_id", orgId)
      .eq("pipeline_type", target.pipelineType)
      .eq("stage_key", target.stageKey)
      .eq("is_active", true)
      .maybeSingle();
    if (error || !data) {
      return { ok: false, error: "post_send_target_stage_not_found" };
    }
    return { ok: true, target };
  }

  const { data, error } = await supabase
    .from("custom_pipeline_stages")
    .select("id")
    .eq("id", target.stageKey)
    .eq("pipeline_id", target.pipelineId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: "post_send_target_stage_not_found" };
  }
  return { ok: true, target };
}

/**
 * Build the `onRecipientsSent` dep for a plan with a post_send_target: move
 * each sent lead to the destination via the canonical moveStage motor.
 * Best-effort per lead — an error is logged and the loop continues (the batch
 * never aborts, and the caller's send path never fails because of the move).
 */
export function buildPostSendMover(
  supabase: any,
  orgId: string,
  rawTarget: unknown,
): (leadIds: string[]) => Promise<void> {
  return async (leadIds: string[]) => {
    const parsed = parsePostSendTarget(rawTarget);
    if (!parsed.ok) {
      console.warn(
        `[post-send-target] plan target unusable (${parsed.error}) — skipping move for ${leadIds.length} lead(s)`,
      );
      return;
    }
    const target = parsed.target;
    // moveStage routing: system → target_pipe = pipe slug; custom → target_pipe
    // = pipeline uuid + target_stage = stage uuid.
    const targetPipe =
      target.funnelKind === "system" ? target.pipelineType! : target.pipelineId!;

    for (const leadId of leadIds) {
      try {
        const result = await moveStage({
          supabase,
          organizationId: orgId,
          leadId,
          // Disparo em massa: a lista é de PESSOAS, e o destino é uma etapa só
          // para todas. Não há negócio por item para declarar.
          entryId: null,
          dealId: null,
          conversationId: null,
          params: { target_pipe: targetPipe, target_stage: target.stageKey },
        });
        if (!result.success) {
          console.warn(
            `[post-send-target] move failed for lead ${leadId}: ${result.error ?? "unknown"}`,
          );
        }
      } catch (e) {
        console.warn(
          `[post-send-target] move threw for lead ${leadId}: ${(e as Error)?.message ?? e}`,
        );
      }
    }
  };
}
