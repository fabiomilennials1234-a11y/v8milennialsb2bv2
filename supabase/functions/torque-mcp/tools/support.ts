import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";
import { runMutation } from "../../_shared/mcp/guardrails.ts";
import { sha256hex, stableStringify } from "../../_shared/mcp/crypto.ts";
import { auditMcpAction } from "../lib/audit.ts";

// Processo de fix em 4 etapas (docs/operations/chamado-fix.md): o Claude Code lê o
// Chamado com `support.ticket_get`, diagnostica o sistema e grava o diagnóstico +
// prompt de resolução com `support.record_diagnosis`. Os domínios abaixo espelham
// os CHECKs de `support_ticket_diagnoses` (20271102000000) — validar aqui dá ao
// agente um erro legível antes do 23514 do banco.

export const KINDS = ["fix", "feature", "configuracao", "duvida"] as const;
export const COMPLEXITIES = ["trivial", "baixa", "media", "alta", "critica"] as const;
export const MODELS = ["haiku", "sonnet", "opus", "fable"] as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const TEMPLATE_VERSION = 1;

export interface Keystone {
  label: string;
  verify: string;
}

export interface DiagnosisRecord {
  ticket_id: string;
  kind: (typeof KINDS)[number];
  complexity: (typeof COMPLEXITIES)[number];
  summary: string;
  root_cause: string | null;
  customer_reply: string | null;
  recommended_model: (typeof MODELS)[number];
  recommended_effort: (typeof EFFORTS)[number];
  resolution_prompt: string;
  keystones: Keystone[];
  estimated_cost_usd: number | null;
  template_version: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function oneOf<T extends readonly string[]>(
  list: T,
  v: unknown,
  field: string,
  errors: string[],
): T[number] {
  if (typeof v === "string" && (list as readonly string[]).includes(v)) return v as T[number];
  errors.push(`${field} must be one of: ${list.join(", ")}`);
  return list[0];
}

function text(
  v: unknown,
  field: string,
  min: number,
  max: number,
  errors: string[],
): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length < min || s.length > max) errors.push(`${field} must have ${min}–${max} chars`);
  return s;
}

function optionalText(v: unknown, field: string, max: number, errors: string[]): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") {
    errors.push(`${field} must be a string`);
    return null;
  }
  const s = v.trim();
  if (s.length > max) errors.push(`${field} must have at most ${max} chars`);
  return s || null;
}

/**
 * Pure: validate + normalize the tool args into the row to write. Returns every
 * problem at once — the agent fixes the whole payload in one round trip.
 */
export function validateDiagnosis(
  args: Record<string, unknown>,
): { ok: true; record: DiagnosisRecord } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  const ticketId = typeof args.ticket_id === "string" ? args.ticket_id.trim() : "";
  if (!UUID.test(ticketId)) errors.push("ticket_id must be a UUID");

  const keystones: Keystone[] = [];
  if (!Array.isArray(args.keystones) || args.keystones.length < 1 || args.keystones.length > 15) {
    errors.push("keystones must be an array of 1–15 items");
  } else {
    args.keystones.forEach((k, i) => {
      const o = (k ?? {}) as Record<string, unknown>;
      const label = typeof o.label === "string" ? o.label.trim() : "";
      const verify = typeof o.verify === "string" ? o.verify.trim() : "";
      if (!label || label.length > 300) errors.push(`keystones[${i}].label must have 1–300 chars`);
      if (!verify || verify.length > 500) {
        errors.push(
          `keystones[${i}].verify must have 1–500 chars (the command/query that proves it)`,
        );
      }
      keystones.push({ label, verify });
    });
  }

  let cost: number | null = null;
  if (args.estimated_cost_usd !== undefined && args.estimated_cost_usd !== null) {
    const n = Number(args.estimated_cost_usd);
    if (!Number.isFinite(n) || n < 0 || n > 999999) {
      errors.push("estimated_cost_usd must be a non-negative number");
    } else cost = Math.round(n * 100) / 100;
  }

  const record: DiagnosisRecord = {
    ticket_id: ticketId,
    kind: oneOf(KINDS, args.kind, "kind", errors),
    complexity: oneOf(COMPLEXITIES, args.complexity, "complexity", errors),
    summary: text(args.summary, "summary", 10, 2000, errors),
    root_cause: optionalText(args.root_cause, "root_cause", 4000, errors),
    customer_reply: optionalText(args.customer_reply, "customer_reply", 4000, errors),
    recommended_model: oneOf(MODELS, args.recommended_model, "recommended_model", errors),
    recommended_effort: oneOf(EFFORTS, args.recommended_effort, "recommended_effort", errors),
    resolution_prompt: text(args.resolution_prompt, "resolution_prompt", 50, 60000, errors),
    keystones,
    estimated_cost_usd: cost,
    template_version: TEMPLATE_VERSION,
  };

  // args.kind, not record.kind: an invalid kind falls back to "fix" above and would
  // add a misleading root_cause error on top of the real one.
  if (args.kind === "fix" && !record.root_cause) {
    errors.push("root_cause is required when kind = fix — a fix without a root cause is a guess");
  }

  return errors.length ? { ok: false, errors } : { ok: true, record };
}

/**
 * Pure: the dry-run plan. Carries a hash of the full normalized record, so the
 * confirm_token binds the exact payload — a different prompt cannot ride on a
 * token minted for another one.
 */
export async function buildDiagnosisPlan(
  record: DiagnosisRecord,
  ticket: { title: unknown; organization_id: unknown; status: unknown },
  existing: boolean,
) {
  return {
    action: existing ? "replace_diagnosis" : "insert_diagnosis",
    ticket_id: record.ticket_id,
    ticket_title: ticket.title,
    organization_id: ticket.organization_id,
    ticket_status: ticket.status,
    kind: record.kind,
    complexity: record.complexity,
    route: `${record.recommended_model} / ${record.recommended_effort}`,
    keystones: record.keystones.length,
    prompt_chars: record.resolution_prompt.length,
    payload_sha256: await sha256hex(stableStringify(record)),
    note: existing
      ? "Overwrites the current diagnosis and clears its execution outcome."
      : "Creates the ticket's diagnosis.",
  };
}

/** Pure: audit params without the long free-text bodies (lengths only). */
export function auditParams(record: DiagnosisRecord): Record<string, unknown> {
  return {
    ...record,
    summary: `[${record.summary.length} chars]`,
    root_cause: record.root_cause ? `[${record.root_cause.length} chars]` : null,
    customer_reply: record.customer_reply ? `[${record.customer_reply.length} chars]` : null,
    resolution_prompt: `[${record.resolution_prompt.length} chars]`,
  };
}

const TICKET_COLS = "id,organization_id,author_user_id,title,description,tipo,impacto," +
  "severidade,status,defect_url,support_context,reopen_count,created_at,updated_at," +
  "organizations(name)";

export const supportTicketGetTool: ToolDef = {
  name: "support.ticket_get",
  description:
    "Read a support Chamado for diagnosis (RLS-scoped as master): the ticket, its captured " +
    "context (route, app version, client errors), the full thread INCLUDING internal notes, " +
    "attachment metadata, and the current diagnosis if any. Provide ticket_id.",
  readonly: true,
  inputSchema: {
    type: "object",
    properties: { ticket_id: { type: "string", description: "Chamado UUID" } },
    required: ["ticket_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const ticketId = String(args.ticket_id ?? "").trim();
    if (!UUID.test(ticketId)) {
      return { content: [{ type: "text", text: "ticket_id must be a UUID." }], isError: true };
    }
    const db = ctx.db as SupabaseClient;

    const { data: ticket, error } = await db.from("support_tickets").select(TICKET_COLS)
      .eq("id", ticketId).maybeSingle();
    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
    if (!ticket) return { content: [{ type: "text", text: "No Chamado found." }] };

    const [comments, attachments, diagnosis] = await Promise.all([
      db.from("support_ticket_comments").select("id,body,is_internal,from_staff,created_at")
        .eq("ticket_id", ticketId).order("created_at", { ascending: true }),
      db.from("support_ticket_attachments")
        .select("id,comment_id,filename,mime,size_bytes,is_internal,created_at")
        .eq("ticket_id", ticketId).is("purged_at", null).order("created_at", { ascending: true }),
      db.from("support_ticket_diagnoses").select("*").eq("ticket_id", ticketId).maybeSingle(),
    ]);
    for (const r of [comments, attachments, diagnosis]) {
      if (r.error) {
        return { content: [{ type: "text", text: `Error: ${r.error.message}` }], isError: true };
      }
    }

    const payload = {
      ticket,
      comments: comments.data ?? [],
      attachments: attachments.data ?? [],
      diagnosis: diagnosis.data ?? null,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  },
};

export const supportRecordDiagnosisTool: ToolDef = {
  name: "support.record_diagnosis",
  description:
    "Record (or replace) the diagnosis + resolution prompt of a support Chamado, shown to the " +
    "dev in the Master support console. Dry-run validates and returns the plan + confirmToken; " +
    "pass confirm_token to apply (audited in master_audit_logs). kind=fix requires root_cause. " +
    "Each keystone needs a `verify` command/query that proves it.",
  readonly: false,
  inputSchema: {
    type: "object",
    properties: {
      ticket_id: { type: "string", description: "Chamado UUID" },
      kind: { type: "string", enum: [...KINDS] },
      complexity: { type: "string", enum: [...COMPLEXITIES] },
      summary: {
        type: "string",
        description: "Diagnóstico simplificado, 10–2000 chars, para o dev operacional",
      },
      root_cause: {
        type: "string",
        description: "Root cause com evidência (arquivo:linha, query). Obrigatório em fix",
      },
      customer_reply: {
        type: "string",
        description: "Rascunho da resposta ao cliente, sem detalhe interno",
      },
      recommended_model: { type: "string", enum: [...MODELS] },
      recommended_effort: { type: "string", enum: [...EFFORTS] },
      resolution_prompt: {
        type: "string",
        description: "Prompt completo de execução (template v1)",
      },
      keystones: {
        type: "array",
        items: {
          type: "object",
          properties: { label: { type: "string" }, verify: { type: "string" } },
          required: ["label", "verify"],
        },
      },
      estimated_cost_usd: { type: "number" },
      confirm_token: { type: "string", description: "Echo the dry-run confirmToken to apply" },
    },
    required: [
      "ticket_id",
      "kind",
      "complexity",
      "summary",
      "recommended_model",
      "recommended_effort",
      "resolution_prompt",
      "keystones",
    ],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const v = validateDiagnosis(args);
    if (!v.ok) {
      return {
        content: [{ type: "text", text: `Invalid diagnosis:\n- ${v.errors.join("\n- ")}` }],
        isError: true,
      };
    }
    const record = v.record;
    const db = ctx.db as SupabaseClient;
    let orgId = "";

    const res = await runMutation({
      plan: async () => {
        const { data: ticket, error } = await db.from("support_tickets")
          .select("id,title,organization_id,status").eq("id", record.ticket_id).maybeSingle();
        if (error) throw new Error(error.message);
        if (!ticket) throw new Error("No Chamado found for that ticket_id.");
        orgId = String(ticket.organization_id);
        const { data: existing, error: eErr } = await db.from("support_ticket_diagnoses")
          .select("ticket_id").eq("ticket_id", record.ticket_id).maybeSingle();
        if (eErr) throw new Error(eErr.message);
        return await buildDiagnosisPlan(record, ticket, !!existing);
      },
      audit: (_i, plan, token) =>
        auditMcpAction(db, {
          tool: "support.record_diagnosis",
          org_id: orgId,
          target_type: "support_ticket",
          target_id: record.ticket_id,
          params: auditParams(record),
          plan,
          confirm_token: token,
        }),
      apply: async () => {
        const { data: auth } = await db.auth.getUser();
        const { error } = await db.from("support_ticket_diagnoses").upsert({
          ...record,
          source: "claude_code",
          diagnosed_by: auth.user?.id ?? null,
          // A new prompt invalidates the previous run's outcome.
          executed_at: null,
          execution_outcome: null,
          actual_cost_usd: null,
        }, { onConflict: "ticket_id" });
        if (error) throw new Error(error.message);
        return { recorded: record.ticket_id };
      },
    }, { confirm_token: typeof args.confirm_token === "string" ? args.confirm_token : undefined });

    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
};
