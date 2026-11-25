/**
 * Deal outcome by AI (fatia 8 do v2) — "mark these as won/lost":
 *
 *   deal.outcome.plan    — validate won/lost/reopen for up to 50 cards; store the plan;
 *   deal.outcome.confirm — apply it through definir_desfecho_da_entrada, the function behind
 *                          the deal card's Won/Lost buttons in the app.
 *
 * That function is SECURITY DEFINER and only checks the ORG of the card (assert_org_access) —
 * not whether the caller sees it, nor pipeline.move_cards. So the plan reads every card under
 * the caller's own RLS in the token org and checks pipeline.move_cards (again at confirm);
 * only cards that passed are ever handed to it. Its side effects are the app's: a sale event,
 * a history entry, the card moving to the won (or lost) stage — which fires that stage's
 * automations — and the value lock for sales.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";
import { actionErrorMessage, isUuid, PLAN, WRITE, writeContext } from "./actions.ts";
import { callerHasFeature, callRpc } from "./rpc.ts";
import { dbErrorResult, errorResult, jsonResult, mapLimit, resolveOrgScope } from "./shared.ts";

export const OUTCOME_MAX = 50;
export const OUTCOMES = ["won", "lost", "open"] as const;
export type Outcome = typeof OUTCOMES[number];

export interface OutcomeRequest {
  entry_id: string;
  outcome: Outcome;
  value?: number;
  loss_reason?: string;
}

/** Validate the requested changes. Pure. */
export function parseOutcomes(
  v: unknown,
): { ok: true; items: OutcomeRequest[] } | { ok: false; message: string } {
  if (!Array.isArray(v) || v.length === 0) return { ok: false, message: "items is required." };
  if (v.length > OUTCOME_MAX) return { ok: false, message: `At most ${OUTCOME_MAX} per plan.` };
  const seen = new Set<string>();
  const items: OutcomeRequest[] = [];
  for (const raw of v) {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (!isUuid(r.entry_id)) return { ok: false, message: "Each item needs entry_id (UUID)." };
    if (seen.has(r.entry_id)) return { ok: false, message: `entry_id repeated: ${r.entry_id}` };
    seen.add(r.entry_id);
    if (!(OUTCOMES as readonly string[]).includes(r.outcome as string)) {
      return { ok: false, message: `outcome must be one of ${OUTCOMES.join(", ")}.` };
    }
    const item: OutcomeRequest = { entry_id: r.entry_id, outcome: r.outcome as Outcome };
    if (r.value !== undefined) {
      const n = Number(r.value);
      if (!Number.isFinite(n) || n < 0 || n > 1e12) {
        return { ok: false, message: "value must be a non-negative number." };
      }
      item.value = Math.round(n * 100) / 100;
    }
    if (typeof r.loss_reason === "string" && r.loss_reason.trim()) {
      item.loss_reason = r.loss_reason.trim().slice(0, 300);
    }
    items.push(item);
  }
  return { ok: true, items };
}

export interface CardRow {
  id: string;
  lead_id: string;
  stage_key: string;
  leads: { name: string | null } | null;
  sale_value: string | null;
  deals: { outcome: string | null; value: number | string | null } | null;
}

export type OutcomeVerdict =
  | { kind: "apply"; item: OutcomeRequest; lead: string | null; from: string; warning?: string }
  | { kind: "skip" | "block"; entry_id: string; reason: string };

/**
 * Decide each item before anything changes: unseen cards are blocked, no-ops skipped. A sale
 * with no value anywhere (deal, card's sale_value, or this request) is WARNED, not blocked:
 * the app's sale lock recovers the card's value and spares some orgs, so only it can say no —
 * and confirm reports its refusal per card. Zero is a value. Pure.
 */
export function judgeOutcome(item: OutcomeRequest, card: CardRow | undefined): OutcomeVerdict {
  if (!card) {
    return {
      kind: "block",
      entry_id: item.entry_id,
      reason: "Card não encontrado (ou você não o vê).",
    };
  }
  const current = card.deals?.outcome ?? "open";
  if (current === item.outcome) {
    return { kind: "skip", entry_id: item.entry_id, reason: `Já está como ${current}.` };
  }
  const hasValue = (card.deals?.value !== null && card.deals?.value !== undefined) ||
    !!card.sale_value?.trim() || item.value !== undefined;
  return {
    kind: "apply",
    item,
    lead: card.leads?.name ?? null,
    from: current,
    ...(item.outcome === "won" && !hasValue
      ? { warning: "Venda sem valor: o Torque pode recusar ao confirmar. Informe value." }
      : {}),
  };
}

const CARD_SELECT =
  "id,lead_id,stage_key,sale_value:metadata->>sale_value,leads(name),deals(outcome,value)";

export const customerDealOutcomePlanTool: ToolDef = {
  name: "deal.outcome.plan",
  description:
    `Plan marking up to ${OUTCOME_MAX} deals as won, lost, or reopened (open), by card ` +
    "(entry_id from funnel.review or lead.get). A sale needs a value if the deal has none; a " +
    "loss can carry loss_reason. Nothing changes yet: returns what will change, what is skipped " +
    "or blocked and why, and confirm_token. Marking won/lost moves the card to the funnel's " +
    "won/lost stage (its automations may fire) and records the sale in Torque's metrics. Only " +
    "with the person's OK call deal.outcome.confirm.",
  readonly: false,
  customerExposed: true,
  requiredScope: "crm:write",
  annotations: { ...PLAN, title: "Plan deal outcomes" },
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        maxItems: OUTCOME_MAX,
        items: {
          type: "object",
          properties: {
            entry_id: { type: "string" },
            outcome: { type: "string", enum: [...OUTCOMES] },
            value: { type: "number", minimum: 0 },
            loss_reason: { type: "string", maxLength: 300 },
          },
          required: ["entry_id", "outcome"],
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const w = writeContext(ctx, "crm:write");
    if (!w.ok) return w.result;
    const parsed = parseOutcomes(args.items);
    if (!parsed.ok) return errorResult(parsed.message);
    if (!(await callerHasFeature(ctx, "pipeline.move_cards"))) {
      return errorResult(
        "Seu usuário não pode mover cards no Torque (permissão pipeline.move_cards).",
      );
    }

    const db = ctx.db as SupabaseClient;
    // Under the caller's RLS, in the token org — the check the DEFINER function lacks.
    const { data, error } = await db.from("pipeline_entries").select(CARD_SELECT)
      .eq("organization_id", scope.orgId).in("id", parsed.items.map((i) => i.entry_id));
    if (error) return dbErrorResult(error);
    const cards = new Map(((data ?? []) as unknown as CardRow[]).map((c) => [c.id, c]));
    const verdicts = parsed.items.map((i) => judgeOutcome(i, cards.get(i.entry_id)));
    const apply = verdicts.filter((v): v is Extract<OutcomeVerdict, { kind: "apply" }> =>
      v.kind === "apply"
    );
    const others = verdicts.filter((v) => v.kind !== "apply") as Array<
      Extract<OutcomeVerdict, { kind: "skip" | "block" }>
    >;
    if (!apply.length) return jsonResult({ confirm_token: null, changes: [], not_applied: others });

    const won = apply.filter((a) => a.item.outcome === "won").length;
    const lost = apply.filter((a) => a.item.outcome === "lost").length;
    try {
      const { actionId, expiresAt } = await w.store.open(
        "deal.outcome",
        "crm:write",
        `Desfecho: ${won} ganho(s), ${lost} perdido(s), ${apply.length - won - lost} reaberto(s)`,
        { items: apply.map((a) => a.item) },
      );
      return jsonResult({
        confirm_token: actionId,
        expires_at: expiresAt,
        changes: apply.map((a) => ({
          entry_id: a.item.entry_id,
          lead: a.lead,
          from: a.from,
          to: a.item.outcome,
          ...(a.item.value !== undefined ? { value: a.item.value } : {}),
          ...(a.item.loss_reason ? { loss_reason: a.item.loss_reason } : {}),
          ...(a.warning ? { warning: a.warning } : {}),
        })),
        ...(others.length ? { not_applied: others } : {}),
        effects:
          "Ganho/perdido move o card para a etapa de ganho/perda do funil (as automações dessa etapa podem disparar) e entra nas métricas de vendas.",
        next: "Mostre à pessoa. Com o OK dela, chame deal.outcome.confirm (vale 5 min).",
      });
    } catch (e) {
      return errorResult(actionErrorMessage(e));
    }
  },
};

export const customerDealOutcomeConfirmTool: ToolDef = {
  name: "deal.outcome.confirm",
  description:
    "Apply a plan from deal.outcome.plan — only after the person approved it. Returns, per " +
    "card, whether it changed.",
  readonly: false,
  customerExposed: true,
  requiredScope: "crm:write",
  annotations: { ...WRITE, title: "Apply deal outcomes" },
  inputSchema: {
    type: "object",
    properties: { confirm_token: { type: "string" } },
    required: ["confirm_token"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const w = writeContext(ctx, "crm:write");
    if (!w.ok) return w.result;
    if (!isUuid(args.confirm_token)) return errorResult("confirm_token inválido.");
    // Re-checked at confirm: the permission may have been taken away since the plan.
    if (!(await callerHasFeature(ctx, "pipeline.move_cards"))) {
      return errorResult("Seu usuário não pode mais mover cards (permissão pipeline.move_cards).");
    }
    const taken = await w.store.take(args.confirm_token);
    if (!taken || taken.tool !== "deal.outcome") {
      return errorResult(
        "Plano inexistente, vencido (5 min), já usado ou sem permissão. Gere outro com deal.outcome.plan.",
      );
    }
    const items = (taken.plan as { items: OutcomeRequest[] }).items;
    // One at a time per card, a few cards at once: each call is a sale-event transaction.
    const results = await mapLimit(items, 3, async (i) => {
      const r = await callRpc<{ outcome?: string; idempotent?: boolean }>(
        ctx,
        "definir_desfecho_da_entrada",
        {
          p_entry_id: i.entry_id,
          p_outcome: i.outcome,
          p_loss_reason: i.loss_reason ?? null,
          p_valor: i.value ?? null,
        },
      );
      return r.error ? { entry_id: i.entry_id, ok: false, error: r.error.message ?? "falhou" } : {
        entry_id: i.entry_id,
        ok: true,
        outcome: r.data?.outcome ?? i.outcome,
        changed: r.data?.idempotent !== true,
      };
    });
    const failed = results.filter((r) => !r.ok).length;
    await w.store.finish(
      args.confirm_token,
      failed === 0 ? "applied" : failed === results.length ? "failed" : "partial",
      { results },
    );
    return failed === results.length
      ? errorResult(`Nenhum desfecho aplicado: ${results.map((r) => r.error).join("; ")}`)
      : jsonResult({ applied: results.length - failed, failed, results });
  },
};
