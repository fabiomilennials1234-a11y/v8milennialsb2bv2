/**
 * post-send-target — the Disparos "Destino" contract (post-send lead move).
 *
 * A Blast Plan may carry a post_send_target: each recipient is moved to a
 * chosen funnel stage AT THE MOMENT its message is sent (per lot — plans drain
 * over days, so the move is per-lead, never all at once).
 *
 * Fatia B (épico Funil é Funil, D1/D4): o destino é UM funil qualquer da org,
 * resolvido por referência — `pipelineRef` (uuid canônico, ou slug/alias
 * legado) + `stageRef` (pipeline_stages.id uuid canônico, ou stage_key
 * legada). O split system/custom morreu; os payloads legados
 * `{funnelKind:"system", pipelineType, stageKey}` e
 * `{funnelKind:"custom", pipelineId, stageKey}` continuam ACEITOS NA LEITURA
 * PRA SEMPRE (planos persistidos carregam esse shape) e normalizam para o
 * mesmo par de referências.
 *
 *   parsePostSendTarget    — pure shape validation/normalization of the
 *     untrusted payload (new + legacy shapes → PostSendTarget).
 *   validatePostSendTarget — FAIL-CLOSED existence check against the org's own
 *     funnels/stages (`pipelines` + `pipeline_stages`, the canonical model).
 *     An invalid target is a 400 at create time — a plan is never persisted
 *     with a broken target.
 *   buildPostSendMover     — the injected `onRecipientsSent` dep: moves each
 *     sent lead via the canonical moveStage motor (which itself resolves any
 *     funnel by uuid/slug/alias). BEST-EFFORT: a per-lead failure is logged
 *     and skipped; it never throws — the lead already received the message,
 *     the send must not fail because of the move.
 *
 * Multi-tenancy: the org id ALWAYS comes from the plan's own organization_id
 * (or the caller's resolved org at create time) — never from the payload.
 */
// deno-lint-ignore-file no-explicit-any
import { moveStage } from "../action-handlers/move-stage.ts";
import {
  isPipelineResolutionError,
  resolvePipeline,
} from "../pipeline-adapter.ts";

export interface PostSendTarget {
  /** Funil de destino: `pipelines.id` (canônico) ou slug/alias legado. */
  pipelineRef: string;
  /** Etapa de destino: `pipeline_stages.id` (canônico) ou `stage_key` legada. */
  stageRef: string;
  /** Human label for panel display only — never used for routing. */
  label: string;
}

const LEGACY_SYSTEM_PIPES = ["whatsapp", "confirmacao", "propostas"] as const;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParseResult =
  | { ok: true; target: PostSendTarget }
  | { ok: false; error: string };

export type ValidateResult =
  | {
      ok: true;
      target: PostSendTarget;
      /**
       * Shape CANÔNICO para persistir em `blast_plans.post_send_target`:
       * `{pipelineId, stageId, label}` (uuids resolvidos na org do chamador).
       * É o formato que a migration 20270917000000 backfilla nos planos
       * legados — leitor novo resolve id-first, leitor velho nem o vê.
       */
      persisted: { pipelineId: string; stageId: string; label: string };
    }
  | { ok: false; error: string };

/**
 * Pure shape check + normalization of the untrusted post_send_target payload
 * (fail-closed). Accepts, in order of precedence:
 *   1. canônico: `{pipelineId, stageId|stageKey, label}` (id uuid; a coluna
 *      backfillada pela migration 20270917000000 também cai aqui);
 *   2. legado system: `{funnelKind:"system", pipelineType, stageKey}`;
 *   3. legado custom: `{funnelKind:"custom", pipelineId, stageKey}` (uuids).
 */
export function parsePostSendTarget(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "post_send_target_invalid" };
  }
  const t = raw as Record<string, unknown>;
  const label = typeof t.label === "string" ? t.label.trim() : "";

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const pipelineId = str(t.pipelineId);
  const stageId = str(t.stageId);
  const stageKey = str(t.stageKey);

  // 1. Canônico — pipelineId uuid + (stageId uuid OU stageKey). Payloads
  // legados custom também carregam {pipelineId, stageKey} e caem aqui de
  // graça: a normalização é idêntica.
  if (UUID_RE.test(pipelineId)) {
    const stageRef = UUID_RE.test(stageId) ? stageId : stageKey;
    if (!stageRef) return { ok: false, error: "post_send_target_missing_stage" };
    // Legado custom prometia stage uuid; sem funnelKind aceitamos key também
    // (o validador fecha a porta de qualquer forma).
    if (t.funnelKind === "custom" && !UUID_RE.test(stageRef)) {
      return { ok: false, error: "post_send_target_invalid_stage_id" };
    }
    return { ok: true, target: { pipelineRef: pipelineId, stageRef, label } };
  }

  // 2. Legado system — pipelineType slug do trio.
  if (t.funnelKind === "system") {
    const pipelineType = str(t.pipelineType);
    if (!LEGACY_SYSTEM_PIPES.includes(pipelineType as any)) {
      return { ok: false, error: "post_send_target_invalid_pipeline_type" };
    }
    if (!stageKey) return { ok: false, error: "post_send_target_missing_stage" };
    return { ok: true, target: { pipelineRef: pipelineType, stageRef: stageKey, label } };
  }

  if (t.funnelKind === "custom") {
    // Chegou aqui sem pipelineId uuid válido.
    return { ok: false, error: "post_send_target_invalid_pipeline_id" };
  }

  return { ok: false, error: "post_send_target_invalid_funnel_kind" };
}

/**
 * FAIL-CLOSED validation: shape + the destination stage must exist in the
 * caller org's funnel. Any miss (foreign org, unknown funnel, wrong stage)
 * rejects — a plan is never persisted pointing at a broken destination.
 *
 * Semântica de etapa espelha o motor moveStage: por uuid casa QUALQUER etapa
 * do funil (paridade com o ramo custom legado, que não filtrava is_active);
 * por stage_key só etapa ATIVA (paridade com o validador system legado).
 */
export async function validatePostSendTarget(
  supabase: any,
  orgId: string,
  raw: unknown,
): Promise<ValidateResult> {
  const parsed = parsePostSendTarget(raw);
  if (!parsed.ok) return parsed;
  const target = parsed.target;

  let pipelineId: string;
  try {
    const pipeline = await resolvePipeline(supabase, orgId, target.pipelineRef);
    pipelineId = pipeline.id;
  } catch (e) {
    if (isPipelineResolutionError(e)) {
      return { ok: false, error: "post_send_target_stage_not_found" };
    }
    throw e;
  }

  const byId = UUID_RE.test(target.stageRef);
  let query = supabase
    .from("pipeline_stages")
    .select("id")
    .eq("organization_id", orgId)
    .eq("pipeline_id", pipelineId);
  query = byId
    ? query.eq("id", target.stageRef)
    : query.eq("stage_key", target.stageRef).eq("is_active", true);
  const { data, error } = await query.maybeSingle();
  if (error || !data) {
    return { ok: false, error: "post_send_target_stage_not_found" };
  }
  return {
    ok: true,
    target,
    persisted: { pipelineId, stageId: data.id as string, label: target.label },
  };
}

/**
 * Build the `onRecipientsSent` dep for a plan with a post_send_target: move
 * each sent lead to the destination via the canonical moveStage motor (which
 * resolves uuid/slug/alias for the funnel and uuid/stage_key for the stage).
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
          params: { target_pipe: target.pipelineRef, target_stage: target.stageRef },
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
