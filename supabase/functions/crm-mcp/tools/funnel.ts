/**
 * Funnel organisation by AI (fatia 2 do v2):
 *   funnel.review     — read, in batch, what the AI needs to judge each card: the funnel's
 *                       stages (with their rules) and each open card with days in stage and
 *                       the tail of its WhatsApp conversation;
 *   deal.move.plan    — validate a list of moves and STORE a plan (no card changes);
 *   deal.move.confirm — apply the stored plan once, through mover_negocio (the same write the
 *                       app, the API and the DB triggers share), as the user;
 *   deal.move.undo    — move back what this token moved, within 24 h, if untouched since.
 *
 * The AI decides; the server only executes what the user could do in the app, after the
 * human confirmed the plan. Every step is recorded in crm_mcp_actions and in the lead
 * history (source 'agent').
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";
import { actionErrorMessage, isUuid, PLAN, WRITE, writeContext } from "./actions.ts";
import { callerHasFeature, callRpc } from "./rpc.ts";
import {
  clampLimit,
  clip,
  dbErrorResult,
  decodeCursor,
  encodeCursor,
  errorResult,
  idleOrFilter,
  isFromUs,
  jsonResult,
  keysetAfter,
  mapLimit,
  optionalUuid,
  READ_ONLY,
  resolveOrgScope,
} from "./shared.ts";

// --- shared shapes --------------------------------------------------------------------

export interface StageRow {
  id: string;
  stage_key: string;
  name: string;
  position: number | null;
  stage_role: string | null;
  requires_sale_value: boolean | null;
  is_final_positive: boolean | null;
  is_final_negative: boolean | null;
  pipeline_id: string;
}

export function stageKind(s: StageRow): "won" | "lost" | "open" {
  if (s.stage_role === "won" || s.is_final_positive) return "won";
  if (s.stage_role === "lost" || s.is_final_negative) return "lost";
  return "open";
}

const DAY_MS = 86_400_000;

export function daysSince(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / DAY_MS)) : null;
}

// --- funnel.review --------------------------------------------------------------------

export const REVIEW_DEFAULT = 15;
export const REVIEW_MAX = 25;
const MSGS_PER_CARD = 6;
export const MSGS_PER_CARD_MAX = 15;

interface MessageLite {
  normalized_phone: string;
  timestamp: string | null;
  direction: string | null;
  message_type: string | null;
  content: string | null;
  transcription_text: string | null;
}

/** The last N messages per phone, oldest first, compact. Pure. */
export function tailByPhone(
  rows: MessageLite[],
  perPhone: number,
): Map<string, Array<Record<string, unknown>>> {
  const out = new Map<string, MessageLite[]>();
  for (const m of rows) {
    const list = out.get(m.normalized_phone) ?? [];
    if (list.length < perPhone) list.push(m); // rows arrive newest first
    out.set(m.normalized_phone, list);
  }
  const shaped = new Map<string, Array<Record<string, unknown>>>();
  for (const [phone, list] of out) {
    shaped.set(
      phone,
      list.reverse().map((m) => ({
        at: m.timestamp,
        from: isFromUs(m.direction) ? "us" : "contact",
        type: m.message_type ?? "text",
        text: clip(m.content ?? m.transcription_text, 400),
      })),
    );
  }
  return shaped;
}

export const customerFunnelReviewTool: ToolDef = {
  name: "funnel.review",
  description:
    "Read the open cards of ONE funnel in batch, to decide where each should be (for counts " +
    "across all funnels use funnel.overview first). Returns the funnel's stages (in order, with " +
    "their rules: which are won/lost, which require a sale value) and, per card: entry_id, " +
    "lead, current stage, days in stage, the last messages_per_card WhatsApp messages (default " +
    `${MSGS_PER_CARD}, 0 = none, oldest first) and whether the contact is waiting for a reply. ` +
    "Filter by stage_keys and idle_days_min. Pages of up to 25 cards (next_cursor). Then " +
    "propose moves with deal.move.plan.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "Review funnel" },
  inputSchema: {
    type: "object",
    properties: {
      pipeline_id: { type: "string", description: "Funnel UUID (pipeline.list)" },
      stage_keys: { type: "array", items: { type: "string" }, description: "Only these stages" },
      idle_days_min: {
        type: "integer",
        minimum: 0,
        maximum: 365,
        description: "Only cards stalled at least N days in their stage",
      },
      messages_per_card: { type: "integer", minimum: 0, maximum: MSGS_PER_CARD_MAX },
      limit: { type: "integer", minimum: 1, maximum: REVIEW_MAX },
      cursor: { type: "string" },
    },
    required: ["pipeline_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const pipelineId = optionalUuid(args.pipeline_id);
    if (!pipelineId || pipelineId === "invalid") return errorResult("pipeline_id must be a UUID.");
    const limit = clampLimit(args.limit, REVIEW_DEFAULT, REVIEW_MAX);
    const cursor = decodeCursor(args.cursor);
    if (cursor === "invalid") return errorResult("cursor is not valid.");
    const stageKeys = Array.isArray(args.stage_keys)
      ? args.stage_keys.filter((k): k is string => typeof k === "string" && k.length <= 120).slice(
        0,
        50,
      )
      : [];
    const idleDays = args.idle_days_min === undefined ? 0 : Number(args.idle_days_min);
    if (!Number.isInteger(idleDays) || idleDays < 0 || idleDays > 365) {
      return errorResult("idle_days_min must be an integer between 0 and 365.");
    }
    const perCard = args.messages_per_card === undefined
      ? MSGS_PER_CARD
      : Number(args.messages_per_card);
    if (!Number.isInteger(perCard) || perCard < 0 || perCard > MSGS_PER_CARD_MAX) {
      return errorResult(
        `messages_per_card must be an integer between 0 and ${MSGS_PER_CARD_MAX}.`,
      );
    }

    const db = ctx.db as SupabaseClient;
    const stagesQ = db
      .from("pipeline_stages")
      .select(
        "id,stage_key,name,position,stage_role,requires_sale_value,is_final_positive,is_final_negative,pipeline_id",
      )
      .eq("organization_id", scope.orgId)
      .eq("pipeline_id", pipelineId)
      .eq("is_active", true)
      .order("position", { ascending: true });

    let cardsQ = db
      .from("pipeline_entries")
      .select(
        "id,deal_id,lead_id,stage_key,entered_at,stage_changed_at,created_at,leads(id,name,company,phone,normalized_phone)",
      )
      .eq("organization_id", scope.orgId) // defense-in-depth on top of RLS
      .eq("pipeline_id", pipelineId)
      .is("closed_at", null);
    if (stageKeys.length) cardsQ = cardsQ.in("stage_key", stageKeys);
    if (idleDays > 0) {
      cardsQ = cardsQ.or(idleOrFilter(new Date(Date.now() - idleDays * DAY_MS).toISOString()));
    }
    if (cursor) cardsQ = cardsQ.or(keysetAfter(cursor));

    const [stagesR, cardsR] = await Promise.all([
      stagesQ,
      cardsQ.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(
        limit,
      ),
    ]);
    if (stagesR.error) return dbErrorResult(stagesR.error);
    if (cardsR.error) return dbErrorResult(cardsR.error);
    const stages = (stagesR.data ?? []) as StageRow[];
    const cards = (cardsR.data ?? []) as unknown as Array<{
      id: string;
      deal_id: string | null;
      lead_id: string;
      stage_key: string;
      entered_at: string | null;
      stage_changed_at: string | null;
      created_at: string;
      leads: {
        id: string;
        name: string | null;
        company: string | null;
        phone: string | null;
        normalized_phone: string | null;
      } | null;
    }>;

    const phones = [
      ...new Set(cards.map((c) => c.leads?.normalized_phone).filter((p): p is string => !!p)),
    ];
    let tails = new Map<string, Array<Record<string, unknown>>>();
    if (phones.length && perCard > 0) {
      // One small query PER PHONE: a shared limit let one chatty contact starve the others
      // (their cards came back with no messages and awaiting_reply unknown).
      const since = new Date(Date.now() - 60 * DAY_MS).toISOString();
      const results = await mapLimit(phones, 8, (phone) =>
        db
          .from("whatsapp_messages")
          .select("normalized_phone,timestamp,direction,message_type,content,transcription_text")
          .eq("organization_id", scope.orgId)
          .eq("normalized_phone", phone)
          .is("deleted_at", null)
          .or("is_group.is.null,is_group.eq.false")
          .gte("timestamp", since)
          .order("timestamp", { ascending: false })
          .limit(perCard));
      const failed = results.find((r) => r.error);
      if (failed?.error) return dbErrorResult(failed.error);
      tails = tailByPhone(results.flatMap((r) => (r.data ?? []) as MessageLite[]), perCard);
    }

    const now = Date.now();
    const byKey = new Map(stages.map((s) => [s.stage_key, s]));
    const out = cards.map((c) => {
      const msgs = (c.leads?.normalized_phone && tails.get(c.leads.normalized_phone)) || [];
      const last = msgs[msgs.length - 1];
      return {
        entry_id: c.id,
        deal_id: c.deal_id,
        lead: {
          id: c.lead_id,
          name: c.leads?.name ?? null,
          company: c.leads?.company ?? null,
          phone: c.leads?.phone ?? null,
        },
        stage: { key: c.stage_key, name: byKey.get(c.stage_key)?.name ?? null },
        days_in_stage: daysSince(c.stage_changed_at ?? c.entered_at ?? c.created_at, now),
        awaiting_reply: last ? last.from === "contact" : null,
        last_messages: msgs,
      };
    });
    const tail = cards[cards.length - 1];
    return jsonResult({
      pipeline_id: pipelineId,
      stages: stages.map((s) => ({
        key: s.stage_key,
        name: s.name,
        kind: stageKind(s),
        ...(s.requires_sale_value ? { requires_sale_value: true } : {}),
      })),
      count: out.length,
      next_cursor: cards.length === limit && tail
        ? encodeCursor({ createdAt: tail.created_at, id: tail.id })
        : null,
      cards: out,
    });
  },
};

// --- funnel.overview ------------------------------------------------------------------

export const OVERVIEW_STALLED_DEFAULT = 7;
const OVERVIEW_MAX_PIPELINES = 30;

interface CountRow {
  stage_key: string;
  cnt: number | string;
}

/** stage_key → count, from the board's count RPC rows. Pure. */
export function countsByStage(rows: CountRow[] | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows ?? []) m.set(r.stage_key, (m.get(r.stage_key) ?? 0) + Number(r.cnt));
  return m;
}

/** One funnel's stages with counts; stalled counts only for open stages. Pure. */
export function shapeOverview(
  pipeline: { id: string; name: string },
  stages: StageRow[],
  all: Map<string, number>,
  stalled: Map<string, number>,
) {
  const rows = stages.map((s) => {
    const kind = stageKind(s);
    return {
      key: s.stage_key,
      name: s.name,
      kind,
      cards: all.get(s.stage_key) ?? 0,
      ...(kind === "open" ? { stalled: stalled.get(s.stage_key) ?? 0 } : {}),
    };
  });
  const open = rows.filter((r) => r.kind === "open");
  return {
    id: pipeline.id,
    name: pipeline.name,
    open_cards: open.reduce((n, r) => n + r.cards, 0),
    stalled_open_cards: open.reduce((n, r) => n + (r.stalled ?? 0), 0),
    won_cards: rows.filter((r) => r.kind === "won").reduce((n, r) => n + r.cards, 0),
    lost_cards: rows.filter((r) => r.kind === "lost").reduce((n, r) => n + r.cards, 0),
    stages: rows,
  };
}

export const customerFunnelOverviewTool: ToolDef = {
  name: "funnel.overview",
  description:
    "The state of every active funnel in one call (or of one, with pipeline_id): its stages in " +
    "board order with how many cards each has, how many open cards are stalled at least " +
    `stalled_days days (default ${OVERVIEW_STALLED_DEFAULT}), and the won/lost columns. Counts ` +
    "are the funnel board's own. Start here to find volume and bottlenecks; then read the cards " +
    "of one funnel/stage with funnel.review.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "Funnels overview" },
  inputSchema: {
    type: "object",
    properties: {
      pipeline_id: { type: "string", description: "Only this funnel (default: all active)" },
      stalled_days: { type: "integer", minimum: 1, maximum: 365 },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const pipelineId = optionalUuid(args.pipeline_id);
    if (pipelineId === "invalid") return errorResult("pipeline_id must be a UUID.");
    const stalledDays = args.stalled_days === undefined
      ? OVERVIEW_STALLED_DEFAULT
      : Number(args.stalled_days);
    if (!Number.isInteger(stalledDays) || stalledDays < 1 || stalledDays > 365) {
      return errorResult("stalled_days must be an integer between 1 and 365.");
    }

    const db = ctx.db as SupabaseClient;
    let pq = db.from("pipelines").select("id,name").eq("organization_id", scope.orgId)
      .eq("is_active", true);
    if (pipelineId) pq = pq.eq("id", pipelineId);
    const { data: pData, error: pErr } = await pq
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true })
      .limit(OVERVIEW_MAX_PIPELINES + 1);
    if (pErr) return dbErrorResult(pErr);
    const all = (pData ?? []) as Array<{ id: string; name: string }>;
    if (all.length === 0) {
      return errorResult(pipelineId ? "Funil não encontrado ou inativo." : "Nenhum funil ativo.");
    }
    const pipelines = all.slice(0, OVERVIEW_MAX_PIPELINES);

    const { data: sData, error: sErr } = await db
      .from("pipeline_stages")
      .select(
        "id,stage_key,name,position,stage_role,requires_sale_value,is_final_positive,is_final_negative,pipeline_id",
      )
      .eq("organization_id", scope.orgId)
      .in("pipeline_id", pipelines.map((p) => p.id))
      .eq("is_active", true)
      .order("position", { ascending: true })
      .limit(1000);
    if (sErr) return dbErrorResult(sErr);
    const stages = (sData ?? []) as StageRow[];

    // Two counts per funnel (all cards; stalled ones), from the board's own RPC.
    const counts = await mapLimit(pipelines, 4, (p) =>
      Promise.all([
        callRpc<CountRow[]>(ctx, "get_pipeline_stage_counts_by_id", {
          p_pipeline_id: p.id,
          p_org_id: scope.orgId,
        }),
        callRpc<CountRow[]>(ctx, "get_pipeline_stage_counts_by_id", {
          p_pipeline_id: p.id,
          p_org_id: scope.orgId,
          p_stalled_min_days: stalledDays,
        }),
      ]));
    const failed = counts.flat().find((r) => r.error);
    if (failed?.error) return dbErrorResult(failed.error);

    return jsonResult({
      stalled_days: stalledDays,
      ...(all.length > OVERVIEW_MAX_PIPELINES
        ? { truncated: true, note: `Só os ${OVERVIEW_MAX_PIPELINES} primeiros funis.` }
        : {}),
      pipelines: pipelines.map((p, i) =>
        shapeOverview(
          p,
          stages.filter((s) => s.pipeline_id === p.id),
          countsByStage(counts[i][0].data),
          countsByStage(counts[i][1].data),
        )
      ),
    });
  },
};

// --- deal.move.plan -------------------------------------------------------------------

export const MAX_MOVES = 100;

export interface MoveRequest {
  entry_id: string;
  to_stage_key: string;
  reason: string;
  sale_value?: number;
  loss_reason?: string;
}

export interface EntryRow {
  id: string;
  pipeline_id: string;
  stage_key: string;
  lead_id: string;
  closed_at: string | null;
  sale_value: string | number | null;
  leads: { name: string | null } | null;
}

export interface PlannedMove {
  entry_id: string;
  pipeline_id: string;
  lead_id: string;
  lead_name: string | null;
  from_stage: string;
  to_stage: string;
  to_stage_name: string;
  reason: string;
  sale_value?: number;
  loss_reason?: string;
}

export type MoveVerdict =
  | { kind: "move"; move: PlannedMove }
  | { kind: "skip"; entry_id: string; why: string }
  | { kind: "block"; entry_id: string; why: string };

export function parseMoves(
  v: unknown,
): { ok: true; moves: MoveRequest[] } | { ok: false; message: string } {
  if (!Array.isArray(v) || v.length === 0) {
    return { ok: false, message: "moves must list at least one move." };
  }
  if (v.length > MAX_MOVES) return { ok: false, message: `At most ${MAX_MOVES} moves per plan.` };
  const seen = new Set<string>();
  const out: MoveRequest[] = [];
  for (const [i, raw] of v.entries()) {
    const m = raw as Record<string, unknown>;
    if (!m || typeof m !== "object") return { ok: false, message: `moves[${i}] is not an object.` };
    if (!isUuid(m.entry_id)) {
      return { ok: false, message: `moves[${i}].entry_id must be a UUID (from funnel.review).` };
    }
    if (seen.has(m.entry_id)) {
      return { ok: false, message: `moves[${i}]: card repeated in the same plan.` };
    }
    seen.add(m.entry_id);
    if (typeof m.to_stage_key !== "string" || !m.to_stage_key.trim()) {
      return { ok: false, message: `moves[${i}].to_stage_key is required.` };
    }
    const reason = typeof m.reason === "string" ? m.reason.trim() : "";
    if (reason.length < 3) {
      return { ok: false, message: `moves[${i}].reason is required (why the AI moves this card).` };
    }
    const req: MoveRequest = {
      entry_id: m.entry_id,
      to_stage_key: m.to_stage_key.trim(),
      reason: reason.slice(0, 300),
    };
    if (m.sale_value !== undefined && m.sale_value !== null) {
      const n = Number(m.sale_value);
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, message: `moves[${i}].sale_value must be ≥ 0.` };
      }
      req.sale_value = Math.round(n * 100) / 100;
    }
    if (typeof m.loss_reason === "string" && m.loss_reason.trim()) {
      req.loss_reason = m.loss_reason.trim().slice(0, 300);
    }
    out.push(req);
  }
  return { ok: true, moves: out };
}

/** Decide each move against the card and its funnel's stages. Pure. */
export function judgeMove(
  req: MoveRequest,
  entry: EntryRow | undefined,
  stages: StageRow[],
): MoveVerdict {
  if (!entry) {
    return {
      kind: "block",
      entry_id: req.entry_id,
      why: "card não encontrado ou fora do seu acesso",
    };
  }
  if (entry.closed_at) return { kind: "skip", entry_id: req.entry_id, why: "card encerrado" };
  if (entry.stage_key === req.to_stage_key) {
    return { kind: "skip", entry_id: req.entry_id, why: "já está nessa etapa" };
  }
  const target = stages.find((s) =>
    s.pipeline_id === entry.pipeline_id && s.stage_key === req.to_stage_key
  );
  if (!target) {
    return {
      kind: "block",
      entry_id: req.entry_id,
      why: `etapa "${req.to_stage_key}" não existe neste funil`,
    };
  }
  const kind = stageKind(target);
  const existingValue = entry.sale_value === null || entry.sale_value === ""
    ? null
    : Number(entry.sale_value);
  if (
    kind === "won" && target.requires_sale_value && req.sale_value === undefined &&
    !Number.isFinite(existingValue)
  ) {
    return {
      kind: "block",
      entry_id: req.entry_id,
      why: `"${target.name}" exige valor da venda — informe sale_value`,
    };
  }
  if (kind === "lost" && !req.loss_reason) {
    return {
      kind: "block",
      entry_id: req.entry_id,
      why: `"${target.name}" é etapa de perda — informe loss_reason`,
    };
  }
  return {
    kind: "move",
    move: {
      entry_id: entry.id,
      pipeline_id: entry.pipeline_id,
      lead_id: entry.lead_id,
      lead_name: entry.leads?.name ?? null,
      from_stage: entry.stage_key,
      to_stage: target.stage_key,
      to_stage_name: target.name,
      reason: req.reason,
      ...(req.sale_value !== undefined ? { sale_value: req.sale_value } : {}),
      ...(req.loss_reason ? { loss_reason: req.loss_reason } : {}),
    },
  };
}

interface WorkflowRow {
  id: string;
  name: string | null;
  trigger_config: Record<string, unknown> | null;
}

/**
 * Would this stage_changed workflow fire for the move? Mirrors the keys the builder writes
 * (pipeline_id, to_stage, from_stage, stages). It is a preview: the database decides.
 */
export function workflowWouldFire(w: WorkflowRow, m: PlannedMove): boolean {
  const c = w.trigger_config ?? {};
  const eq = (k: string, v: string) =>
    c[k] === undefined || c[k] === null || c[k] === "" || c[k] === v;
  if (!eq("pipeline_id", m.pipeline_id)) return false;
  if (!eq("to_stage", m.to_stage)) return false;
  if (!eq("from_stage", m.from_stage)) return false;
  if (Array.isArray(c.stages) && c.stages.length > 0 && !c.stages.includes(m.to_stage)) {
    return false;
  }
  return true;
}

async function loadEntries(db: SupabaseClient, orgId: string, ids: string[]) {
  return await db
    .from("pipeline_entries")
    .select(
      "id,pipeline_id,stage_key,lead_id,closed_at,sale_value:metadata->>sale_value,leads(name)",
    )
    .eq("organization_id", orgId)
    .in("id", ids);
}

export const customerDealMovePlanTool: ToolDef = {
  name: "deal.move.plan",
  description:
    "Plan moving cards between stages of their funnel (up to 100). Nothing changes yet: each " +
    "move is checked against what YOUR user may do in Torque and the stage rules (won stages " +
    "may require sale_value, loss stages require loss_reason), and the automations that would " +
    "fire are listed. Returns confirm_token: show the plan to the person and only then call " +
    "deal.move.confirm. Every move needs a short reason (it goes to the lead history).",
  readonly: false,
  customerExposed: true,
  requiredScope: "crm:write",
  annotations: { ...PLAN, title: "Plan card moves" },
  inputSchema: {
    type: "object",
    properties: {
      moves: {
        type: "array",
        maxItems: MAX_MOVES,
        items: {
          type: "object",
          properties: {
            entry_id: { type: "string" },
            to_stage_key: { type: "string" },
            reason: { type: "string" },
            sale_value: { type: "number" },
            loss_reason: { type: "string" },
          },
          required: ["entry_id", "to_stage_key", "reason"],
        },
      },
    },
    required: ["moves"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const w = writeContext(ctx, "crm:write");
    if (!w.ok) return w.result;
    const parsed = parseMoves(args.moves);
    if (!parsed.ok) return errorResult(parsed.message);
    if (!(await callerHasFeature(ctx, "pipeline.move_cards"))) {
      return errorResult(
        "Seu usuário não pode mover cards no Torque (permissão pipeline.move_cards).",
      );
    }

    const db = ctx.db as SupabaseClient;
    const ids = parsed.moves.map((m) => m.entry_id);
    const er = await loadEntries(db, scope.orgId, ids);
    if (er.error) return dbErrorResult(er.error);
    const entries = (er.data ?? []) as unknown as EntryRow[];
    const pipelineIds = [...new Set(entries.map((e) => e.pipeline_id))];

    const stagesR = pipelineIds.length
      ? await db
        .from("pipeline_stages")
        .select(
          "id,stage_key,name,position,stage_role,requires_sale_value,is_final_positive,is_final_negative,pipeline_id",
        )
        .eq("organization_id", scope.orgId)
        .in("pipeline_id", pipelineIds)
        .eq("is_active", true)
      : { data: [], error: null };
    if (stagesR.error) return dbErrorResult(stagesR.error);
    const stages = (stagesR.data ?? []) as StageRow[];

    const byId = new Map(entries.map((e) => [e.id, e]));
    const verdicts = parsed.moves.map((m) => judgeMove(m, byId.get(m.entry_id), stages));
    const moves = verdicts.filter((v): v is { kind: "move"; move: PlannedMove } =>
      v.kind === "move"
    ).map((v) => v.move);
    const skipped = verdicts.filter((v) => v.kind === "skip");
    const blocked = verdicts.filter((v) => v.kind === "block");

    // Side effects preview: automations on stage change and automatic WhatsApp per stage.
    const targetStageIds = [
      ...new Set(
        moves.map((m) =>
          stages.find((s) => s.pipeline_id === m.pipeline_id && s.stage_key === m.to_stage)?.id
        ).filter(Boolean),
      ),
    ] as string[];
    const [wfR, ruleR] = await Promise.all([
      moves.length
        ? db.from("workflows").select("id,name,trigger_config").eq("organization_id", scope.orgId)
          .eq("trigger_type", "stage_changed").eq("is_active", true).limit(1000)
        : Promise.resolve({ data: [], error: null }),
      targetStageIds.length
        ? db.from("pipe_dispatch_rules").select("id,pipeline_stage_id").eq(
          "organization_id",
          scope.orgId,
        ).eq("is_active", true).eq("trigger_type", "lead_moved_to_stage").in(
          "pipeline_stage_id",
          targetStageIds,
        )
        : Promise.resolve({ data: [], error: null }),
    ]);
    // The plan tells the person which automations a move fires; a failed lookup must not read
    // as "none" — that would be approval obtained on a false premise.
    if (wfR.error) return dbErrorResult(wfR.error);
    if (ruleR.error) return dbErrorResult(ruleR.error);
    const workflows = (wfR.data ?? []) as WorkflowRow[];
    const rules = (ruleR.data ?? []) as Array<{ pipeline_stage_id: string }>;
    const effects = moves.map((m) => {
      const stageId = stages.find((s) =>
        s.pipeline_id === m.pipeline_id && s.stage_key === m.to_stage
      )?.id;
      return {
        entry_id: m.entry_id,
        automations: workflows.filter((wf) => workflowWouldFire(wf, m)).map((wf) =>
          wf.name ?? wf.id
        ),
        sends_whatsapp: rules.some((r) => r.pipeline_stage_id === stageId),
      };
    }).filter((e) => e.automations.length || e.sends_whatsapp);

    if (moves.length === 0) {
      return jsonResult({
        confirm_token: null,
        to_move: 0,
        skipped,
        blocked,
        note: "Nada a mover.",
      });
    }

    const summary = `Mover ${moves.length} card(s): ` +
      moves.slice(0, 5).map((m) => `${m.lead_name ?? m.entry_id} → ${m.to_stage_name}`).join("; ") +
      (moves.length > 5 ? "; …" : "");
    try {
      const { actionId, expiresAt } = await w.store.open("deal.move", "crm:write", summary, {
        moves,
      });
      return jsonResult({
        confirm_token: actionId,
        expires_at: expiresAt,
        to_move: moves.length,
        moves: moves.map((m) => ({
          entry_id: m.entry_id,
          lead: m.lead_name,
          from: m.from_stage,
          to: m.to_stage_name,
          reason: m.reason,
        })),
        side_effects: effects,
        skipped,
        blocked,
        next:
          "Mostre este plano à pessoa. Só com o OK dela, chame deal.move.confirm com confirm_token (vale 5 min).",
      });
    } catch (e) {
      return errorResult(actionErrorMessage(e));
    }
  },
};

// --- deal.move.confirm / undo -----------------------------------------------------------

function taskMessage(err: { message?: string; code?: string } | null): string {
  const m = err?.message ?? "";
  if (/task_reason_required/.test(m)) return "a etapa atual tem tarefas obrigatórias pendentes";
  if (/insufficient_privilege|permission denied|42501/.test(m + (err?.code ?? ""))) {
    return "sem permissão para mover este card";
  }
  if (/exige valor|sale_value/.test(m)) return "a etapa exige valor da venda";
  return clip(m, 160) ?? "erro ao mover";
}

async function applyMove(
  ctx: ToolContext,
  db: SupabaseClient,
  orgId: string,
  m: {
    entry_id: string;
    pipeline_id: string;
    from_stage: string;
    to_stage: string;
    sale_value?: number;
    loss_reason?: string;
  },
): Promise<{ ok: true; entry_id: string } | { ok: false; why: string }> {
  const cur = await db
    .from("pipeline_entries")
    .select("id,stage_key,closed_at,metadata")
    .eq("organization_id", orgId)
    .eq("id", m.entry_id)
    .maybeSingle();
  if (cur.error) return { ok: false, why: taskMessage(cur.error) };
  const row = cur.data as {
    stage_key: string;
    closed_at: string | null;
    metadata: Record<string, unknown> | null;
  } | null;
  if (!row) return { ok: false, why: "card não encontrado ou fora do seu acesso" };
  if (row.closed_at) return { ok: false, why: "card encerrado desde o plano" };
  if (row.stage_key !== m.from_stage) {
    return { ok: false, why: "card mudou de etapa desde o plano" };
  }

  // What the app's move dialog writes before the move (sale value, loss reason).
  if (m.sale_value !== undefined || m.loss_reason) {
    const metadata = {
      ...(row.metadata ?? {}),
      ...(m.sale_value !== undefined ? { sale_value: m.sale_value } : {}),
      ...(m.loss_reason ? { loss_reason: m.loss_reason } : {}),
    };
    const up = await db.from("pipeline_entries").update({ metadata }).eq("organization_id", orgId)
      .eq("id", m.entry_id).select("id");
    if (up.error || !up.data?.length) return { ok: false, why: taskMessage(up.error) };
  }

  const { data, error } = await callRpc<string>(ctx, "mover_negocio", {
    p_entry_id: m.entry_id,
    p_target_pipeline_id: m.pipeline_id,
    p_target_stage_key: m.to_stage,
    p_stage_origem: null,
    p_assigned_to: null,
  });
  if (error) return { ok: false, why: taskMessage(error) };
  return { ok: true, entry_id: typeof data === "string" ? data : m.entry_id };
}

async function writeHistory(
  db: SupabaseClient,
  ctx: ToolContext,
  m: PlannedMove,
  actionId: string,
  description: string,
): Promise<void> {
  // Best effort: the move already happened and crm_mcp_actions holds the full trail.
  await db.from("lead_history").insert({
    lead_id: m.lead_id,
    organization_id: ctx.orgId,
    action: "stage_changed",
    description,
    created_by: ctx.userId,
    source: "agent",
    entity_type: "pipeline_entry",
    entity_id: m.entry_id,
    metadata: {
      via: "crm-mcp",
      action_id: actionId,
      pat_id: ctx.patId ?? null,
      pipeline_id: m.pipeline_id,
      from_stage: m.from_stage,
      to_stage: m.to_stage,
      reason: m.reason,
    },
  });
}

export const customerDealMoveConfirmTool: ToolDef = {
  name: "deal.move.confirm",
  description:
    "Apply a plan from deal.move.plan — only after the person approved it. Applies once, " +
    "within 5 minutes, and skips any card that changed since the plan. Moves run as your " +
    "user, exactly like moving the card in Torque (automations on the stage fire). Returns " +
    "undo_token (valid 24 h) for deal.move.undo.",
  readonly: false,
  customerExposed: true,
  requiredScope: "crm:write",
  annotations: { ...WRITE, title: "Apply card moves" },
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

    const taken = await w.store.take(args.confirm_token);
    if (!taken || taken.tool !== "deal.move") {
      return errorResult(
        "Plano inexistente, vencido (5 min), já usado ou sem permissão. Gere outro com deal.move.plan.",
      );
    }
    const moves = ((taken.plan as { moves?: PlannedMove[] })?.moves ?? []).slice(0, MAX_MOVES);
    const db = ctx.db as SupabaseClient;

    const moved: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];
    for (const m of moves) {
      const r = await applyMove(ctx, db, scope.orgId, m);
      if (r.ok) {
        moved.push({
          entry_id: r.entry_id,
          planned_entry_id: m.entry_id,
          pipeline_id: m.pipeline_id,
          from_stage: m.from_stage,
          to_stage: m.to_stage,
          lead: m.lead_name,
        });
        await writeHistory(
          db,
          ctx,
          m,
          args.confirm_token,
          `Movido pela IA para "${m.to_stage_name}": ${m.reason}`,
        );
      } else {
        failed.push({ entry_id: m.entry_id, lead: m.lead_name, why: r.why });
      }
    }
    const status = failed.length === 0 ? "applied" : moved.length === 0 ? "failed" : "partial";
    await w.store.finish(args.confirm_token, status, { moved, failed });
    return jsonResult({
      status,
      moved: moved.length,
      failed,
      undo_token: moved.length ? args.confirm_token : null,
      note: moved.length
        ? "Desfazer (24 h) devolve os cards à etapa anterior, mas não desfaz automações e mensagens já disparadas."
        : undefined,
    });
  },
};

export const customerDealMoveUndoTool: ToolDef = {
  name: "deal.move.undo",
  description:
    "Undo a deal.move.confirm of this same token within 24 h: each card still in the stage it " +
    "was moved to goes back to its previous stage. Automations and messages that already fired " +
    "are not undone.",
  readonly: false,
  customerExposed: true,
  requiredScope: "crm:write",
  annotations: { ...WRITE, title: "Undo card moves" },
  inputSchema: {
    type: "object",
    properties: { undo_token: { type: "string" } },
    required: ["undo_token"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const w = writeContext(ctx, "crm:write");
    if (!w.ok) return w.result;
    if (!isUuid(args.undo_token)) return errorResult("undo_token inválido.");
    if (!(await callerHasFeature(ctx, "pipeline.move_cards"))) {
      return errorResult(
        "Seu usuário não pode mover cards no Torque (permissão pipeline.move_cards).",
      );
    }

    const prev = await w.store.getApplied(args.undo_token);
    if (!prev || prev.tool !== "deal.move") {
      return errorResult(
        "Nada a desfazer: ação inexistente, de outro token, já desfeita ou com mais de 24 h.",
      );
    }
    const done = (prev.result as { moved?: Array<Record<string, string>> })?.moved ?? [];
    const db = ctx.db as SupabaseClient;

    // The undo is itself an audited action.
    let undoId: string;
    try {
      const opened = await w.store.open(
        "deal.move.undo",
        "crm:write",
        `Desfazer ${done.length} movimentação(ões)`,
        {
          undo_of: args.undo_token,
          moves: done,
        },
      );
      undoId = opened.actionId;
      if (!(await w.store.take(undoId))) throw new Error("take failed");
    } catch (e) {
      return errorResult(actionErrorMessage(e));
    }

    const back: Array<Record<string, unknown>> = [];
    const kept: Array<Record<string, unknown>> = [];
    for (const d of done) {
      const r = await applyMove(ctx, db, scope.orgId, {
        entry_id: d.entry_id,
        pipeline_id: d.pipeline_id,
        from_stage: d.to_stage,
        to_stage: d.from_stage,
      });
      if (r.ok) back.push({ entry_id: d.entry_id, to_stage: d.from_stage, lead: d.lead });
      else kept.push({ entry_id: d.entry_id, lead: d.lead, why: r.why });
    }
    const status = kept.length === 0 ? "applied" : back.length === 0 ? "failed" : "partial";
    await w.store.finish(undoId, status, { returned: back, kept, undo_of: args.undo_token });
    if (back.length) await w.store.markUndone(args.undo_token);
    return jsonResult({ status, returned: back.length, kept });
  },
};
