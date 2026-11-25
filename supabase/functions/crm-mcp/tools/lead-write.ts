/**
 * Writes on a lead by AI (fatia 8 do v2), all under the `crm:write` scope:
 *
 *   note.add          — a note on the lead (lead_comments), authored by the caller;
 *   followup.create   — a follow-up for the caller or a teammate (fires the org's webhooks);
 *   followup.complete — closes one;
 *   lead.tag.plan / lead.tag.confirm — add/remove tags on up to 100 leads. Two steps because a
 *                       tag can fire automations (trg_workflow_tag_added → tag_added
 *                       workflows, which may send WhatsApp): the plan names them.
 *
 * Visibility first: lead_comments, follow_ups and lead_tags check the ORG only in RLS, never
 * whether the person sees the lead — so every write loads its lead(s) through `leads` (whose
 * RLS is the visibility rule) before touching the child table. The feature permission each
 * screen asks is asked here too (or a stricter one where the screen asks none).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";
import { matchesTriggerConfig } from "../../_shared/workflow-trigger.ts";
import { actionErrorMessage, auditedWrite, isUuid, PLAN, WRITE, writeContext } from "./actions.ts";
import { callerHasFeature } from "./rpc.ts";
import {
  dbErrorResult,
  errorResult,
  jsonResult,
  localMidnightUtc,
  memberNames,
  myMemberId,
  readOrgTimezone,
  resolveOrgScope,
} from "./shared.ts";

export const NOTE_MAX = 4000;
export const TAG_LEADS_MAX = 100;
const DAY_MS = 86_400_000;

async function denyWithout(ctx: ToolContext, key: string, what: string) {
  return (await callerHasFeature(ctx, key))
    ? null
    : errorResult(`Seu usuário não pode ${what} no Torque (permissão ${key}).`);
}

/** The lead, if the caller sees it (leads RLS) in the token org. */
async function visibleLead(db: SupabaseClient, orgId: string, leadId: string) {
  return await db.from("leads").select("id,name").eq("organization_id", orgId).eq("id", leadId)
    .is("deleted_at", null).maybeSingle();
}

const NOT_VISIBLE = "Lead não encontrado (ou você não tem acesso a ele).";

/** RLS refusals on follow_ups name the app's own limit (it checks the user's FIRST org). */
function writeError(e: { message?: string; code?: string } | null): string {
  if (e?.code === "42501") {
    return "O Torque recusou a gravação para o seu usuário nesta organização (permissão do banco).";
  }
  return e?.message ?? "falha ao gravar";
}

// --- note.add ------------------------------------------------------------------------------

export const customerNoteAddTool: ToolDef = {
  name: "note.add",
  description:
    "Add a note to a lead, as the person (it shows in the lead's notes and history, authored " +
    "by them). Optionally tie it to one of the lead's cards (entry_id). Write the note the " +
    "person asked for; do not add notes on your own initiative.",
  readonly: false,
  customerExposed: true,
  requiredScope: "crm:write",
  annotations: { ...WRITE, destructiveHint: false, title: "Add note" },
  inputSchema: {
    type: "object",
    properties: {
      lead_id: { type: "string" },
      text: { type: "string", maxLength: NOTE_MAX },
      entry_id: { type: "string", description: "One of the lead's cards (optional)" },
    },
    required: ["lead_id", "text"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const w = writeContext(ctx, "crm:write");
    if (!w.ok) return w.result;
    if (!isUuid(args.lead_id)) return errorResult("lead_id must be a UUID.");
    if (args.entry_id !== undefined && !isUuid(args.entry_id)) {
      return errorResult("entry_id must be a UUID.");
    }
    const text = typeof args.text === "string" ? args.text.trim() : "";
    if (!text || text.length > NOTE_MAX) return errorResult(`text: 1–${NOTE_MAX} characters.`);

    const db = ctx.db as SupabaseClient;
    const [lead, me] = await Promise.all([
      visibleLead(db, scope.orgId, args.lead_id),
      myMemberId(db, scope.orgId, ctx.userId!),
    ]);
    if (lead.error) return dbErrorResult(lead.error);
    if (!lead.data) return errorResult(NOT_VISIBLE);
    if ("error" in me) return dbErrorResult(me.error);

    const leadName = (lead.data as { name: string | null }).name ?? "lead";
    const out = await auditedWrite(ctx, "crm:write", "note.add", `Nota em ${leadName}`, {
      lead_id: args.lead_id,
      entry_id: args.entry_id ?? null,
    }, async () => {
      const ins = await db.from("lead_comments").insert({
        organization_id: scope.orgId,
        lead_id: args.lead_id,
        author_user_id: ctx.userId, // the insert policy requires the author to be the caller
        author_team_member_id: me.id,
        body: text,
        pipeline_entry_id: args.entry_id ?? null, // a trigger refuses a card of another lead
      }).select("id").single();
      return ins.error || !ins.data
        ? { ok: false, result: { error: writeError(ins.error) } }
        : { ok: true, result: { note_id: (ins.data as { id: string }).id } };
    });
    if ("error" in out) return errorResult(out.error);
    return out.ok
      ? jsonResult({ added: true, ...(out.result as object), lead: lead.data })
      : errorResult(`Não foi possível salvar a nota: ${(out.result as { error: string }).error}`);
  },
};

// --- followup.create / followup.complete ---------------------------------------------------

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * A due time from the AI, in the org's calendar: a date alone means 09:00 local; a datetime
 * without zone is local; one with Z/offset is taken as is. Refuses the past (beyond today)
 * and more than two years ahead. Pure.
 */
export function parseDue(
  v: unknown,
  tz: string,
  now: Date,
): { ok: true; iso: string } | { ok: false; message: string } {
  if (typeof v !== "string" || !v.trim()) return { ok: false, message: "due_at is required." };
  const s = v.trim();
  let ms: number;
  const local = LOCAL_DATETIME.exec(s);
  if (DATE_ONLY.test(s)) ms = localMidnightUtc(s, tz).getTime() + 9 * 3_600_000;
  else if (local) {
    ms = localMidnightUtc(local[1], tz).getTime() + Number(local[2]) * 3_600_000 +
      Number(local[3]) * 60_000 + Number(local[4] ?? 0) * 1000;
  } else ms = Date.parse(s);
  if (!Number.isFinite(ms)) {
    return { ok: false, message: "due_at must be YYYY-MM-DD, YYYY-MM-DDTHH:MM or ISO-8601." };
  }
  const today = localMidnightUtc(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now),
    tz,
  ).getTime();
  if (ms < today) return { ok: false, message: "due_at is in the past." };
  if (ms > now.getTime() + 731 * DAY_MS) {
    return { ok: false, message: "due_at is more than two years ahead." };
  }
  return { ok: true, iso: new Date(ms).toISOString() };
}

export const customerFollowupCreateTool: ToolDef = {
  name: "followup.create",
  description:
    "Create a follow-up on a lead: title, due_at (YYYY-MM-DD = 09:00 in the organization's " +
    "timezone; or a local YYYY-MM-DDTHH:MM; or ISO-8601), optional description, priority and " +
    "who does it (assigned_to = team member id from team.list; default: the person). It shows " +
    "in Follow-ups and the Agenda, and the organization's integrations are notified.",
  readonly: false,
  customerExposed: true,
  requiredScope: "crm:write",
  annotations: { ...WRITE, destructiveHint: false, title: "Create follow-up" },
  inputSchema: {
    type: "object",
    properties: {
      lead_id: { type: "string" },
      title: { type: "string", maxLength: 200 },
      due_at: { type: "string" },
      description: { type: "string", maxLength: 2000 },
      priority: { type: "string", enum: [...PRIORITIES] },
      assigned_to: { type: "string", description: "Team member id (team.list)" },
      entry_id: { type: "string", description: "One of the lead's cards (optional)" },
    },
    required: ["lead_id", "title", "due_at"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const w = writeContext(ctx, "crm:write");
    if (!w.ok) return w.result;
    for (const k of ["lead_id", "assigned_to", "entry_id"] as const) {
      if (args[k] !== undefined && !isUuid(args[k])) return errorResult(`${k} must be a UUID.`);
    }
    const title = typeof args.title === "string" ? args.title.trim() : "";
    if (!title || title.length > 200) return errorResult("title: 1–200 characters.");
    const description = typeof args.description === "string" ? args.description.trim() : "";
    if (description.length > 2000) return errorResult("description: up to 2000 characters.");
    const priority = (args.priority ?? "normal") as string;
    if (!(PRIORITIES as readonly string[]).includes(priority)) {
      return errorResult(`priority must be one of ${PRIORITIES.join(", ")}.`);
    }
    const denied = await denyWithout(ctx, "followups.create", "criar follow-ups");
    if (denied) return denied;

    const db = ctx.db as SupabaseClient;
    const [lead, tzR, me] = await Promise.all([
      visibleLead(db, scope.orgId, args.lead_id as string),
      readOrgTimezone(db, scope.orgId),
      myMemberId(db, scope.orgId, ctx.userId!),
    ]);
    if (lead.error) return dbErrorResult(lead.error);
    if (!lead.data) return errorResult(NOT_VISIBLE);
    if ("error" in tzR) return dbErrorResult(tzR.error);
    if ("error" in me) return dbErrorResult(me.error);
    const due = parseDue(args.due_at, tzR.tz, new Date());
    if (!due.ok) return errorResult(due.message);

    const assignee = (args.assigned_to as string | undefined) ?? me.id;
    if (!assignee) return errorResult("Informe assigned_to (você não é membro ativo desta org).");
    if (args.assigned_to) {
      const { data: member, error } = await db.from("org_visible_members").select("id")
        .eq("organization_id", scope.orgId).eq("id", assignee).eq("is_active", true)
        .maybeSingle();
      if (error) return dbErrorResult(error);
      if (!member) return errorResult("assigned_to não é um membro ativo desta organização.");
    }

    const leadName = (lead.data as { name: string | null }).name ?? "lead";
    const out = await auditedWrite(
      ctx,
      "crm:write",
      "followup.create",
      `Follow-up "${title}" para ${leadName}`,
      { lead_id: args.lead_id, due_at: due.iso, assigned_to: assignee },
      async () => {
        const ins = await db.from("follow_ups").insert({
          organization_id: scope.orgId,
          lead_id: args.lead_id,
          title,
          description: description || null,
          due_date: due.iso,
          priority,
          assigned_to: assignee,
          pipeline_entry_id: args.entry_id ?? null,
          is_automated: false,
        }).select("id").single();
        return ins.error || !ins.data
          ? { ok: false, result: { error: writeError(ins.error) } }
          : { ok: true, result: { followup_id: (ins.data as { id: string }).id } };
      },
    );
    if ("error" in out) return errorResult(out.error);
    if (!out.ok) {
      return errorResult(
        `Não foi possível criar o follow-up: ${(out.result as { error: string }).error}`,
      );
    }
    const names = await memberNames(db, scope.orgId, [assignee]);
    return jsonResult({
      created: true,
      ...(out.result as object),
      title,
      due_at: due.iso,
      timezone: tzR.tz,
      assigned_to: { id: assignee, name: names.get(assignee) ?? null },
      lead: lead.data,
    });
  },
};

export const customerFollowupCompleteTool: ToolDef = {
  name: "followup.complete",
  description:
    "Mark a follow-up as done (followup_id from followup.list), with optional notes on how it " +
    "went. Only follow-ups of leads the person can see.",
  readonly: false,
  customerExposed: true,
  requiredScope: "crm:write",
  annotations: { ...WRITE, destructiveHint: false, title: "Complete follow-up" },
  inputSchema: {
    type: "object",
    properties: {
      followup_id: { type: "string" },
      notes: { type: "string", maxLength: 1000 },
    },
    required: ["followup_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const w = writeContext(ctx, "crm:write");
    if (!w.ok) return w.result;
    if (!isUuid(args.followup_id)) return errorResult("followup_id must be a UUID.");
    const notes = typeof args.notes === "string" ? args.notes.trim().slice(0, 1000) : "";
    const denied = await denyWithout(ctx, "followups.view", "mexer em follow-ups");
    if (denied) return denied;

    const db = ctx.db as SupabaseClient;
    // Through the lead (INNER): a follow-up of a lead the person cannot see is "not found".
    const { data: fu, error } = await db.from("follow_ups")
      .select("id,title,completed_at,leads!inner(id,name)")
      .eq("organization_id", scope.orgId).eq("id", args.followup_id)
      .is("archived_at", null).is("leads.deleted_at", null).maybeSingle();
    if (error) return dbErrorResult(error);
    if (!fu) return errorResult("Follow-up não encontrado (ou você não tem acesso a ele).");
    const row = fu as { id: string; title: string | null; completed_at: string | null };
    if (row.completed_at) {
      return jsonResult({ completed: true, followup_id: row.id, note: "Já estava concluído." });
    }

    const out = await auditedWrite(
      ctx,
      "crm:write",
      "followup.complete",
      `Concluir follow-up "${row.title ?? row.id}"`,
      { followup_id: row.id },
      async () => {
        // `.select` because an UPDATE that matches no row still answers 200 in PostgREST.
        const up = await db.from("follow_ups").update({
          completed_at: new Date().toISOString(),
          ...(notes ? { completion_notes: notes } : {}),
        }).eq("organization_id", scope.orgId).eq("id", row.id).is("completed_at", null)
          .select("id");
        const ok = !up.error && (up.data ?? []).length === 1;
        return { ok, result: ok ? { followup_id: row.id } : { error: writeError(up.error) } };
      },
    );
    if ("error" in out) return errorResult(out.error);
    return out.ok
      ? jsonResult({ completed: true, followup_id: row.id, title: row.title })
      : errorResult("Não foi possível concluir (já concluído por outra pessoa ou sem permissão).");
  },
};

// --- lead.tag.plan / lead.tag.confirm ------------------------------------------------------

interface TagRow {
  id: string;
  name: string;
}

/** Tag refs (ids or names, case-insensitive) → tags of the org; unknown ones listed. Pure. */
export function resolveTags(
  refs: string[],
  catalog: TagRow[],
): { tags: TagRow[]; unknown: string[] } {
  const tags: TagRow[] = [];
  const unknown: string[] = [];
  for (const ref of refs) {
    const r = ref.trim();
    const t = catalog.find((c) => c.id === r) ??
      catalog.find((c) => String(c.name ?? "").trim().toLowerCase() === r.toLowerCase());
    if (!t) unknown.push(r);
    else if (!tags.some((x) => x.id === t.id)) tags.push(t);
  }
  return { tags, unknown };
}

export interface TagChange {
  lead_id: string;
  tag_id: string;
}

/** What actually changes: adds the lead lacks, removes the lead has. Pure. */
export function diffTags(
  leads: Array<{ id: string; tag_ids: string[] }>,
  add: TagRow[],
  remove: TagRow[],
): { adds: TagChange[]; removes: TagChange[] } {
  const adds: TagChange[] = [];
  const removes: TagChange[] = [];
  for (const l of leads) {
    for (const t of add) if (!l.tag_ids.includes(t.id)) adds.push({ lead_id: l.id, tag_id: t.id });
    for (const t of remove) {
      if (l.tag_ids.includes(t.id)) removes.push({ lead_id: l.id, tag_id: t.id });
    }
  }
  return { adds, removes };
}

const refsOf = (v: unknown) =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && !!x.trim() && x.length <= 120).slice(
      0,
      10,
    )
    : [];

export const customerLeadTagPlanTool: ToolDef = {
  name: "lead.tag.plan",
  description:
    `Plan adding and/or removing tags (by name or id) on up to ${TAG_LEADS_MAX} leads. Nothing ` +
    "changes yet: returns what will really change (leads that already have/lack a tag are " +
    "skipped), which automations adding each tag fires (tag automations may send WhatsApp), " +
    "and confirm_token. Show it to the person; only with their OK call lead.tag.confirm. Tags " +
    "must already exist in Torque (creating tags is for admins in the app).",
  readonly: false,
  customerExposed: true,
  requiredScope: "crm:write",
  annotations: { ...PLAN, title: "Plan tag changes" },
  inputSchema: {
    type: "object",
    properties: {
      lead_ids: { type: "array", items: { type: "string" }, maxItems: TAG_LEADS_MAX },
      add: { type: "array", items: { type: "string" }, description: "Tag names or ids" },
      remove: { type: "array", items: { type: "string" }, description: "Tag names or ids" },
    },
    required: ["lead_ids"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const w = writeContext(ctx, "crm:write");
    if (!w.ok) return w.result;
    const ids = Array.isArray(args.lead_ids) ? [...new Set(args.lead_ids.filter(isUuid))] : [];
    if (!ids.length || ids.length > TAG_LEADS_MAX) {
      return errorResult(`lead_ids: 1–${TAG_LEADS_MAX} lead UUIDs.`);
    }
    const addRefs = refsOf(args.add);
    const removeRefs = refsOf(args.remove);
    if (!addRefs.length && !removeRefs.length) return errorResult("Informe add e/ou remove.");
    const denied = await denyWithout(ctx, "leads.edit", "editar leads");
    if (denied) return denied;

    const db = ctx.db as SupabaseClient;
    const [catalogR, leadsR] = await Promise.all([
      db.from("tags").select("id,name").eq("organization_id", scope.orgId).limit(1000),
      // tags are embedded through `leads`: the lead's visibility decides what is touched
      db.from("leads").select("id,name,lead_tags(tag_id)").eq("organization_id", scope.orgId)
        .in("id", ids).is("deleted_at", null),
    ]);
    if (catalogR.error) return dbErrorResult(catalogR.error);
    if (leadsR.error) return dbErrorResult(leadsR.error);
    const catalog = (catalogR.data ?? []) as TagRow[];
    const add = resolveTags(addRefs, catalog);
    const remove = resolveTags(removeRefs, catalog);
    const unknown = [...add.unknown, ...remove.unknown];
    if (unknown.length) {
      return errorResult(
        `Etiqueta(s) inexistente(s) nesta organização: ${unknown.join(", ")}. ` +
          "Criar etiquetas é feito por um admin no Torque.",
      );
    }
    const leads = ((leadsR.data ?? []) as Array<
      { id: string; name: string | null; lead_tags: Array<{ tag_id: string }> | null }
    >).map((l) => ({ id: l.id, name: l.name, tag_ids: (l.lead_tags ?? []).map((t) => t.tag_id) }));
    const missing = ids.filter((id) => !leads.some((l) => l.id === id));
    const { adds, removes } = diffTags(leads, add.tags, remove.tags);

    // Which tag_added automations each added tag fires — the engine's own matcher.
    let firing: Array<{ tag: string; automations: string[] }> = [];
    if (adds.length) {
      const { data: wfs, error } = await db.from("workflows").select("id,name,trigger_config")
        .eq("organization_id", scope.orgId).eq("trigger_type", "tag_added").eq("is_active", true)
        .limit(500);
      if (error) return dbErrorResult(error); // never promise "no automations" on a failed read
      firing = add.tags.map((t) => ({
        tag: t.name,
        automations: ((wfs ?? []) as Array<
          { id: string; name: string | null; trigger_config: Record<string, unknown> | null }
        >).filter((wf) =>
          matchesTriggerConfig("tag_added", wf.trigger_config ?? {}, {
            tag_id: t.id,
            tag_name: t.name,
          })
        ).map((wf) => wf.name ?? wf.id),
      })).filter((f) => f.automations.length);
    }

    if (!adds.length && !removes.length) {
      return jsonResult({
        confirm_token: null,
        note: "Nada a mudar: os leads já estão como pedido.",
        ...(missing.length ? { not_found: missing } : {}),
      });
    }
    try {
      const { actionId, expiresAt } = await w.store.open(
        "lead.tag",
        "crm:write",
        `Etiquetas: +${adds.length} / −${removes.length} em ${leads.length} lead(s)`,
        { adds, removes },
      );
      const byId = new Map(leads.map((l) => [l.id, l.name]));
      const tagName = new Map(catalog.map((t) => [t.id, t.name]));
      return jsonResult({
        confirm_token: actionId,
        expires_at: expiresAt,
        add: adds.map((c) => ({ lead: byId.get(c.lead_id), tag: tagName.get(c.tag_id) })),
        remove: removes.map((c) => ({ lead: byId.get(c.lead_id), tag: tagName.get(c.tag_id) })),
        ...(firing.length ? { automations_fired_by_added_tags: firing } : {}),
        ...(missing.length ? { not_found: missing } : {}),
        next: "Mostre à pessoa. Com o OK dela, chame lead.tag.confirm (vale 5 min).",
      });
    } catch (e) {
      return errorResult(actionErrorMessage(e));
    }
  },
};

export const customerLeadTagConfirmTool: ToolDef = {
  name: "lead.tag.confirm",
  description:
    "Apply a tag plan from lead.tag.plan — only after the person approved it. Added tags fire " +
    "their automations at once.",
  readonly: false,
  customerExposed: true,
  requiredScope: "crm:write",
  annotations: { ...WRITE, title: "Apply tag changes" },
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
    const denied = await denyWithout(ctx, "leads.edit", "editar leads");
    if (denied) return denied;

    const taken = await w.store.take(args.confirm_token);
    if (!taken || taken.tool !== "lead.tag") {
      return errorResult(
        "Plano inexistente, vencido (5 min), já usado ou sem permissão. Gere outro com lead.tag.plan.",
      );
    }
    const plan = taken.plan as { adds: TagChange[]; removes: TagChange[] };
    const db = ctx.db as SupabaseClient;
    const errors: string[] = [];
    let added = 0;
    let removed = 0;
    if (plan.adds.length) {
      // ON CONFLICT DO NOTHING on (lead_id, tag_id): a tag someone added meanwhile is not an
      // error. lead_tags' own insert policy re-checks the lead belongs to the caller's org.
      const ins = await db.from("lead_tags").upsert(plan.adds, {
        onConflict: "lead_id,tag_id",
        ignoreDuplicates: true,
      }).select("id");
      if (ins.error) errors.push(writeError(ins.error));
      else added = (ins.data ?? []).length;
    }
    const byTag = new Map<string, string[]>();
    for (const r of plan.removes) byTag.set(r.tag_id, [...(byTag.get(r.tag_id) ?? []), r.lead_id]);
    for (const [tagId, leadIds] of byTag) {
      const del = await db.from("lead_tags").delete().eq("tag_id", tagId).in("lead_id", leadIds)
        .select("id");
      if (del.error) errors.push(writeError(del.error));
      else removed += (del.data ?? []).length;
    }
    const status = errors.length ? (added || removed ? "partial" : "failed") : "applied";
    await w.store.finish(args.confirm_token, status, { added, removed, errors });
    return errors.length && !added && !removed
      ? errorResult(`Nada foi aplicado: ${errors.join("; ")}`)
      : jsonResult({ applied: true, added, removed, ...(errors.length ? { errors } : {}) });
  },
};
