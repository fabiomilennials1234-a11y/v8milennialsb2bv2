/**
 * WhatsApp broadcast by AI (fatia 3 do v2) — "send X to everyone stalled > N days in funnel Y".
 *
 *   audience.preview   — who would receive it (and who is left out, and why); read-only;
 *   broadcast.plan     — message + numbers + audience snapshot, stored as a plan;
 *   broadcast.test     — the rendered message to the CALLER's own phone, before anyone else;
 *   broadcast.confirm  — hands the stored plan to the app's Disparos engine (blast-plan-create)
 *                        AS THE USER: same daily budget, per-number cap, anti-ban spacing and
 *                        send window as a broadcast made on the Disparos screen;
 *   broadcast.status / broadcast.cancel.
 *
 * Guards the engine does not have, added here on purpose:
 *  - numbers reserved for a department (reserved_for, e.g. collections) are never used — the
 *    engine would fail after creating the plan;
 *  - the first lot goes out the moment a plan is created, at any hour; so confirm only runs
 *    inside the send window (Mon–Sat 08:00–20:00, org time);
 *  - the engine resolves the org from the user's FIRST membership, so a multi-org user is
 *    refused with an explanation instead of broadcasting in the wrong org.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";
import { personalizationFirstName, personalizationName } from "../../_shared/lead-name.ts";
import { resolveBlastMessage } from "../../_shared/quick-blast/message-resolver.ts";
import {
  actionErrorMessage,
  type EdgeInvoker,
  isUuid,
  PLAN,
  WRITE,
  writeContext,
} from "./actions.ts";
import {
  dbErrorResult,
  errorResult,
  jsonResult,
  optionalUuid,
  pgrstQuote,
  READ_ONLY,
  resolveOrgScope,
} from "./shared.ts";

export const AUDIENCE_MAX = 1000;
export const MESSAGE_MAX = 1000;
const DAY_MS = 86_400_000;

// --- audience (pure parts) -------------------------------------------------------------

export interface AudienceFilter {
  pipelineId: string;
  stageKeys: string[];
  idleDaysMin: number;
}

export function parseAudience(
  v: unknown,
): { ok: true; filter: AudienceFilter } | { ok: false; message: string } {
  const a = (v ?? {}) as Record<string, unknown>;
  const pipelineId = optionalUuid(a.pipeline_id);
  if (!pipelineId || pipelineId === "invalid") {
    return { ok: false, message: "audience.pipeline_id must be a UUID." };
  }
  const stageKeys = Array.isArray(a.stage_keys)
    ? a.stage_keys.filter((k): k is string =>
      typeof k === "string" && !!k.trim() && k.length <= 120
    ).slice(0, 50)
    : [];
  const idle = a.idle_days_min === undefined || a.idle_days_min === null
    ? 0
    : Number(a.idle_days_min);
  if (!Number.isInteger(idle) || idle < 0 || idle > 365) {
    return { ok: false, message: "audience.idle_days_min must be an integer between 0 and 365." };
  }
  return { ok: true, filter: { pipelineId, stageKeys, idleDaysMin: idle } };
}

/**
 * "Stalled since before X" over COALESCE(stage_changed_at, entered_at, created_at) — the
 * definition the funnel board uses — as one PostgREST `or` group.
 */
export function idleOrFilter(cutoffIso: string): string {
  const q = pgrstQuote(cutoffIso);
  return `stage_changed_at.lt.${q},` +
    `and(stage_changed_at.is.null,entered_at.lt.${q}),` +
    `and(stage_changed_at.is.null,entered_at.is.null,created_at.lt.${q})`;
}

export interface AudienceLead {
  id: string;
  name: string | null;
  company: string | null;
  segment: string | null;
}

interface EntryWithLead {
  lead_id: string;
  leads: {
    id: string;
    name: string | null;
    company: string | null;
    segment: string | null;
    normalized_phone: string | null;
    deleted_at: string | null;
  } | null;
}

/** Dedupe by lead, drop leads without phone or deleted. Pure. */
export function shapeAudience(rows: EntryWithLead[]): {
  leads: AudienceLead[];
  excluded: { sem_telefone: number; lead_apagado: number; repetidos: number };
} {
  const seen = new Set<string>();
  const leads: AudienceLead[] = [];
  const excluded = { sem_telefone: 0, lead_apagado: 0, repetidos: 0 };
  for (const r of rows) {
    if (seen.has(r.lead_id)) {
      excluded.repetidos++;
      continue;
    }
    seen.add(r.lead_id);
    if (!r.leads || r.leads.deleted_at) {
      excluded.lead_apagado++;
      continue;
    }
    if (!r.leads.normalized_phone) {
      excluded.sem_telefone++;
      continue;
    }
    leads.push({
      id: r.leads.id,
      name: r.leads.name,
      company: r.leads.company,
      segment: r.leads.segment,
    });
  }
  return { leads, excluded };
}

/** The variables the Disparos engine freezes per lead (blast-plan.ts snapshotVars). */
export function leadVars(
  l: { name: string | null; company?: string | null; segment?: string | null },
) {
  return {
    nome: personalizationName(l.name),
    primeiro_nome: personalizationFirstName(l.name),
    empresa: l.company ?? "",
    segmento: l.segment ?? "",
  };
}

export function renderPreview(message: string, l: AudienceLead): string {
  return resolveBlastMessage(message, leadVars(l), () => 0);
}

// --- send window (pure) -----------------------------------------------------------------

/** Mon–Sat 08:00–20:00 in the org's timezone — the Disparos default window. */
export function inSendWindow(now: Date, timeZone: string): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  if (parts.weekday === "Sun") return false;
  const minutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  return minutes >= 8 * 60 && minutes < 20 * 60;
}

/** The send-window clock; tests pin it instead of patching the global Date. */
export const clock = { now: (): Date => new Date() };

/** Rough number of days the engine needs (org budget 200/day, 80/day per number). */
export function estimateDays(recipients: number, numbers: number): number {
  const perDay = Math.max(1, Math.min(200, 80 * Math.max(1, numbers)));
  return Math.max(1, Math.ceil(recipients / perDay));
}

// --- db helpers ---------------------------------------------------------------------------

async function buildAudience(db: SupabaseClient, orgId: string, f: AudienceFilter) {
  let q = db
    .from("pipeline_entries")
    .select("lead_id,leads(id,name,company,segment,normalized_phone,deleted_at)")
    .eq("organization_id", orgId) // defense-in-depth on top of RLS
    .eq("pipeline_id", f.pipelineId)
    .is("closed_at", null);
  if (f.stageKeys.length) q = q.in("stage_key", f.stageKeys);
  if (f.idleDaysMin > 0) {
    q = q.or(idleOrFilter(new Date(Date.now() - f.idleDaysMin * DAY_MS).toISOString()));
  }
  const { data, error } = await q.order("created_at", { ascending: true }).limit(AUDIENCE_MAX);
  if (error) return { error };
  const rows = (data ?? []) as unknown as EntryWithLead[];
  return { ...shapeAudience(rows), truncated: rows.length === AUDIENCE_MAX };
}

interface InstanceRow {
  id: string;
  instance_name: string | null;
  phone_number: string | null;
  status: string | null;
  provider: string | null;
  reserved_for: string | null;
}

/** Numbers a broadcast may use: connected, Uazapi (the bulk path), never a reserved one. */
export function eligibleInstances(rows: InstanceRow[]): InstanceRow[] {
  return rows.filter((r) => r.status === "connected" && r.provider === "uazapi" && !r.reserved_for);
}

async function loadInstances(db: SupabaseClient, orgId: string) {
  return await db
    .from("whatsapp_instances")
    .select("id,instance_name,phone_number,status,provider,reserved_for")
    .eq("organization_id", orgId)
    .limit(100);
}

async function memberships(db: SupabaseClient, ctx: ToolContext): Promise<number> {
  const { data } = await db.from("team_members").select("organization_id").eq("user_id", ctx.userId)
    .eq("is_active", true);
  return new Set(((data ?? []) as Array<{ organization_id: string }>).map((r) => r.organization_id))
    .size;
}

const MULTI_ORG =
  "Disparo pela IA ainda não funciona para quem participa de mais de uma organização (o motor de " +
  "Disparos escolhe a organização sozinho). Use a tela de Disparos.";

async function orgTimezone(db: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await db.from("organizations").select("timezone").eq("id", orgId).maybeSingle();
  return (data as { timezone?: string } | null)?.timezone || "America/Sao_Paulo";
}

function edgeOf(ctx: ToolContext): EdgeInvoker | null {
  return (ctx.edge as EdgeInvoker | undefined) ?? null;
}

// --- tools --------------------------------------------------------------------------------

const AUDIENCE_SCHEMA = {
  type: "object",
  properties: {
    pipeline_id: { type: "string", description: "Funnel UUID" },
    stage_keys: { type: "array", items: { type: "string" }, description: "Only these stages" },
    idle_days_min: {
      type: "integer",
      minimum: 0,
      maximum: 365,
      description: "Stalled at least N days",
    },
  },
  required: ["pipeline_id"],
};

export const customerAudiencePreviewTool: ToolDef = {
  name: "audience.preview",
  description:
    "Preview a broadcast audience: open cards of a funnel, optionally only some stages and only " +
    "cards stalled at least N days in their stage. Returns how many leads would receive it, a " +
    "sample, and who is left out (no phone, deleted, repeated). Up to 1000 leads.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "Preview broadcast audience" },
  inputSchema: { ...AUDIENCE_SCHEMA, additionalProperties: false } as ToolDef["inputSchema"],
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const a = parseAudience(args);
    if (!a.ok) return errorResult(a.message);
    const aud = await buildAudience(ctx.db as SupabaseClient, scope.orgId, a.filter);
    if ("error" in aud && aud.error) return dbErrorResult(aud.error);
    const r = aud as Exclude<typeof aud, { error: unknown }>;
    return jsonResult({
      total: r.leads.length,
      truncated_at_1000: r.truncated,
      excluded: r.excluded,
      sample: r.leads.slice(0, 10).map((l) => ({ id: l.id, name: l.name, company: l.company })),
    });
  },
};

export const customerBroadcastPlanTool: ToolDef = {
  name: "broadcast.plan",
  description:
    "Plan a WhatsApp broadcast to an audience (same filters as audience.preview). The message " +
    "may use {{primeiro_nome}}, {{nome}}, {{empresa}}, {{segmento}} and spintax. Nothing is sent: " +
    "returns 3 rendered examples, the numbers it will use, how many days the Disparos engine " +
    "needs (daily limits and anti-ban spacing apply) and confirm_token. Use broadcast.test to " +
    "send it to yourself first; only with the person's OK call broadcast.confirm.",
  readonly: false,
  customerExposed: true,
  requiredScope: "messages:send",
  annotations: { ...PLAN, title: "Plan WhatsApp broadcast" },
  inputSchema: {
    type: "object",
    properties: {
      audience: AUDIENCE_SCHEMA,
      message: { type: "string", maxLength: MESSAGE_MAX },
      instance_ids: {
        type: "array",
        items: { type: "string" },
        description: "Sending numbers (default: all eligible)",
      },
      exclude_blasted_within_days: {
        type: "integer",
        minimum: 0,
        maximum: 90,
        description: "Default 7",
      },
    },
    required: ["audience", "message"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const w = writeContext(ctx, "messages:send");
    if (!w.ok) return w.result;
    const a = parseAudience(args.audience);
    if (!a.ok) return errorResult(a.message);
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message) return errorResult("message is required.");
    if (message.length > MESSAGE_MAX) {
      return errorResult(`message is limited to ${MESSAGE_MAX} characters.`);
    }
    const excl = args.exclude_blasted_within_days === undefined
      ? 7
      : Number(args.exclude_blasted_within_days);
    if (!Number.isInteger(excl) || excl < 0 || excl > 90) {
      return errorResult("exclude_blasted_within_days: 0–90.");
    }

    const db = ctx.db as SupabaseClient;
    if ((await memberships(db, ctx)) > 1) return errorResult(MULTI_ORG);

    const [aud, inst] = await Promise.all([
      buildAudience(db, scope.orgId, a.filter),
      loadInstances(db, scope.orgId),
    ]);
    if ("error" in aud && aud.error) return dbErrorResult(aud.error);
    if (inst.error) return dbErrorResult(inst.error);
    const r = aud as Exclude<typeof aud, { error: unknown }>;
    if (r.leads.length === 0) {
      return jsonResult({
        confirm_token: null,
        total: 0,
        excluded: r.excluded,
        note: "Ninguém a receber.",
      });
    }

    const eligible = eligibleInstances((inst.data ?? []) as InstanceRow[]);
    let chosen = eligible;
    if (Array.isArray(args.instance_ids) && args.instance_ids.length) {
      const wanted = new Set(args.instance_ids.filter(isUuid));
      chosen = eligible.filter((i) => wanted.has(i.id));
      if (chosen.length !== wanted.size) {
        return errorResult(
          "Algum número escolhido não está conectado, não é Uazapi ou é reservado a um setor.",
        );
      }
    }
    if (chosen.length === 0) {
      return errorResult(
        "Nenhum número conectado disponível para disparo (números de setor não entram).",
      );
    }

    const leadIds = r.leads.map((l) => l.id);
    const summary = `Disparo para ${leadIds.length} lead(s) por ${chosen.length} número(s)`;
    try {
      const { actionId, expiresAt } = await w.store.open(
        "broadcast.send",
        "messages:send",
        summary,
        {
          lead_ids: leadIds,
          message,
          instance_ids: chosen.map((i) => i.id),
          exclude_blasted_within_days: excl,
          audience: a.filter,
        },
      );
      return jsonResult({
        confirm_token: actionId,
        expires_at: expiresAt,
        total: leadIds.length,
        truncated_at_1000: r.truncated,
        excluded: r.excluded,
        numbers: chosen.map((i) => ({ id: i.id, name: i.instance_name, phone: i.phone_number })),
        examples: r.leads.slice(0, 3).map((l) => ({
          lead: l.name,
          text: renderPreview(message, l),
        })),
        estimated_days: estimateDays(leadIds.length, chosen.length),
        rules:
          "Limite diário da org e de cada número, espaçamento anti-ban e janela seg–sáb 8h–20h valem como no Disparos. Quem recebeu disparo nos últimos " +
          `${excl} dia(s) fica de fora.`,
        next:
          "Teste com broadcast.test, mostre o plano à pessoa e só com o OK dela chame broadcast.confirm (vale 5 min).",
      });
    } catch (e) {
      return errorResult(actionErrorMessage(e));
    }
  },
};

/** Record a one-shot write (no separate plan step) in the audit trail. */
async function auditNow(
  ctx: ToolContext,
  tool: string,
  summary: string,
  payload: unknown,
  run: () => Promise<{ ok: boolean; result: unknown }>,
): Promise<{ ok: boolean; result: unknown } | { error: string }> {
  const w = writeContext(ctx, "messages:send");
  if (!w.ok) return { error: "sem escopo" };
  try {
    const { actionId } = await w.store.open(tool, "messages:send", summary, payload);
    if (!(await w.store.take(actionId))) return { error: "Não foi possível registrar a ação." };
    const out = await run();
    await w.store.finish(actionId, out.ok ? "applied" : "failed", out.result);
    return out;
  } catch (e) {
    return { error: actionErrorMessage(e) };
  }
}

export const customerBroadcastTestTool: ToolDef = {
  name: "broadcast.test",
  description:
    "Send the broadcast message, rendered with YOUR name, to YOUR own phone (the one in your " +
    "Torque profile) from one sending number — to check it before anyone else gets it.",
  readonly: false,
  customerExposed: true,
  requiredScope: "messages:send",
  annotations: { ...WRITE, destructiveHint: false, title: "Send test to myself" },
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", maxLength: MESSAGE_MAX },
      instance_id: { type: "string", description: "Sending number (default: first eligible)" },
    },
    required: ["message"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const w = writeContext(ctx, "messages:send");
    if (!w.ok) return w.result;
    const edge = edgeOf(ctx);
    if (!edge) return errorResult("Envio indisponível neste servidor.");
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message || message.length > MESSAGE_MAX) {
      return errorResult(`message: 1–${MESSAGE_MAX} characters.`);
    }

    const db = ctx.db as SupabaseClient;
    const [me, inst] = await Promise.all([
      db.from("team_members").select("name,phone").eq("organization_id", scope.orgId).eq(
        "user_id",
        ctx.userId,
      ).eq("is_active", true).maybeSingle(),
      loadInstances(db, scope.orgId),
    ]);
    if (me.error) return dbErrorResult(me.error);
    if (inst.error) return dbErrorResult(inst.error);
    const profile = me.data as { name: string | null; phone: string | null } | null;
    const phone = (profile?.phone ?? "").replace(/\D/g, "");
    if (phone.length < 10) {
      return errorResult("Cadastre seu celular no seu perfil do Torque para receber o teste.");
    }
    const eligible = eligibleInstances((inst.data ?? []) as InstanceRow[]);
    const instance = isUuid(args.instance_id)
      ? eligible.find((i) => i.id === args.instance_id)
      : eligible[0];
    if (!instance) return errorResult("Nenhum número conectado disponível para o teste.");

    const text = renderPreview(message, {
      id: "me",
      name: profile?.name ?? null,
      company: null,
      segment: null,
    });
    const number = phone.startsWith("55") ? phone : `55${phone}`;
    const out = await auditNow(ctx, "broadcast.test", `Teste de disparo para o próprio número`, {
      instance_id: instance.id,
    }, async () => {
      const r = await edge("whatsapp-api-proxy", {
        action: "sendText",
        instance_id: instance.id,
        organization_id: scope.orgId,
        payload: { number, text },
      });
      return { ok: r.status >= 200 && r.status < 300, result: { status: r.status } };
    });
    if ("error" in out) return errorResult(out.error);
    return out.ok
      ? jsonResult({ sent: true, to: `…${number.slice(-4)}`, from: instance.instance_name, text })
      : errorResult("O WhatsApp não aceitou o envio de teste. Confira se o número está conectado.");
  },
};

export const customerBroadcastConfirmTool: ToolDef = {
  name: "broadcast.confirm",
  description:
    "Start a broadcast planned with broadcast.plan — only after the person approved it. Runs " +
    "only inside the send window (Mon–Sat 08:00–20:00, organization time), because the first " +
    "lot goes out immediately. Messages cannot be unsent; broadcast.cancel stops what is still " +
    "queued. Returns blast_plan_id for broadcast.status.",
  readonly: false,
  customerExposed: true,
  requiredScope: "messages:send",
  annotations: { ...WRITE, title: "Start WhatsApp broadcast" },
  inputSchema: {
    type: "object",
    properties: { confirm_token: { type: "string" } },
    required: ["confirm_token"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const w = writeContext(ctx, "messages:send");
    if (!w.ok) return w.result;
    const edge = edgeOf(ctx);
    if (!edge) return errorResult("Envio indisponível neste servidor.");
    if (!isUuid(args.confirm_token)) return errorResult("confirm_token inválido.");

    const db = ctx.db as SupabaseClient;
    // Checked BEFORE consuming the plan, so a refusal does not burn it.
    if (!inSendWindow(clock.now(), await orgTimezone(db, scope.orgId))) {
      return errorResult(
        "Fora da janela de envio (seg–sáb, 8h–20h no horário da organização). Confirme dentro da janela.",
      );
    }
    if ((await memberships(db, ctx)) > 1) return errorResult(MULTI_ORG);

    const taken = await w.store.take(args.confirm_token);
    if (!taken || taken.tool !== "broadcast.send") {
      return errorResult(
        "Plano inexistente, vencido (5 min), já usado ou sem permissão. Gere outro com broadcast.plan.",
      );
    }
    const plan = taken.plan as {
      lead_ids: string[];
      message: string;
      instance_ids: string[];
      exclude_blasted_within_days: number;
    };
    const r = await edge("blast-plan-create", {
      instance_ids: plan.instance_ids,
      lead_ids: plan.lead_ids,
      message: plan.message,
      exclude_blasted_within_days: plan.exclude_blasted_within_days,
      delay_min_ms: 5000,
      delay_max_ms: 30000,
      source: { via: "crm-mcp", action_id: args.confirm_token },
    });
    const ok = r.status === 200 && r.body?.ok === true && typeof r.body?.plan_id === "string";
    if (!ok) {
      // The engine inserts the plan BEFORE sending lot 1; a send failure returns an error
      // without the id. Find the plan this confirmation created (tagged with the action id) so
      // the person is never told "failed" while a broadcast exists.
      const { data: orphan } = await db
        .from("blast_plans")
        .select("id,status,total_recipients")
        .eq("organization_id", scope.orgId)
        .eq("created_by", ctx.userId)
        .eq("source->>action_id", args.confirm_token)
        .maybeSingle();
      const engineError = String(r.body?.error ?? `HTTP ${r.status}`);
      const created = orphan as { id: string; status: string; total_recipients: number } | null;
      await w.store.finish(args.confirm_token, created ? "partial" : "failed", {
        status: r.status,
        blast_plan_id: created?.id ?? null,
        error: engineError,
      });
      if (created) {
        return jsonResult({
          started: false,
          blast_plan_id: created.id,
          plan_status: created.status,
          engine_error: engineError,
          note:
            "O disparo foi criado, mas o primeiro lote não saiu. Veja em Disparos ou use broadcast.cancel.",
        });
      }
      return errorResult(`O motor de Disparos recusou: ${engineError}`);
    }
    await w.store.finish(args.confirm_token, "applied", {
      status: r.status,
      blast_plan_id: r.body?.plan_id ?? null,
      total_recipients: r.body?.total_recipients ?? null,
      lots_total: r.body?.lots_total ?? null,
    });
    return jsonResult({
      started: true,
      blast_plan_id: r.body!.plan_id,
      total_recipients: r.body!.total_recipients,
      lots_total: r.body!.lots_total,
      note:
        "O primeiro lote sai agora; os demais, um por dia, respeitando os limites. Acompanhe com broadcast.status.",
    });
  },
};

export const customerBroadcastStatusTool: ToolDef = {
  name: "broadcast.status",
  description:
    "Status of a broadcast: lots released, and how many messages were sent, failed, skipped or are pending.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "Broadcast status" },
  inputSchema: {
    type: "object",
    properties: { blast_plan_id: { type: "string" } },
    required: ["blast_plan_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    if (!isUuid(args.blast_plan_id)) return errorResult("blast_plan_id must be a UUID.");
    const db = ctx.db as SupabaseClient;
    const { data: plan, error } = await db
      .from("blast_plans")
      .select(
        "id,status,total_recipients,lots_total,lots_released,next_release_date,created_at,message",
      )
      .eq("organization_id", scope.orgId)
      .eq("id", args.blast_plan_id)
      .maybeSingle();
    if (error) return dbErrorResult(error);
    if (!plan) return errorResult("Disparo não encontrado.");
    const counts: Record<string, number> = {};
    for (const s of ["sent", "failed", "skipped", "pending"]) {
      const { count } = await db
        .from("blast_plan_recipients")
        .select("id", { count: "exact", head: true })
        .eq("plan_id", args.blast_plan_id)
        .eq("status", s);
      counts[s] = count ?? 0;
    }
    return jsonResult({ ...plan, recipients: counts });
  },
};

export const customerBroadcastCancelTool: ToolDef = {
  name: "broadcast.cancel",
  description:
    "Cancel a broadcast: messages still pending are not sent. A lot already handed to WhatsApp " +
    "may finish sending.",
  readonly: false,
  customerExposed: true,
  requiredScope: "messages:send",
  annotations: { ...WRITE, title: "Cancel broadcast" },
  inputSchema: {
    type: "object",
    properties: { blast_plan_id: { type: "string" } },
    required: ["blast_plan_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const w = writeContext(ctx, "messages:send");
    if (!w.ok) return w.result;
    const edge = edgeOf(ctx);
    if (!edge) return errorResult("Indisponível neste servidor.");
    if (!isUuid(args.blast_plan_id)) return errorResult("blast_plan_id must be a UUID.");
    const out = await auditNow(ctx, "broadcast.cancel", "Cancelar disparo", {
      blast_plan_id: args.blast_plan_id,
    }, async () => {
      const r = await edge("blast-plan-control", { plan_id: args.blast_plan_id, action: "cancel" });
      return { ok: r.status >= 200 && r.status < 300, result: { status: r.status, body: r.body } };
    });
    if ("error" in out) return errorResult(out.error);
    return out.ok
      ? jsonResult({
        cancelled: true,
        note: "Pendentes não saem. Um lote já entregue ao WhatsApp pode terminar.",
      })
      : errorResult(
        `Não foi possível cancelar: ${
          JSON.stringify((out.result as { body?: unknown })?.body ?? {})
        }`,
      );
  },
};
