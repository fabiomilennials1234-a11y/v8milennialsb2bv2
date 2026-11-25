/**
 * One WhatsApp message to one lead, by AI (fatia 8 do v2) — "answer Ana that the proposal goes
 * out tomorrow". Under `messages:send`:
 *
 *   message.plan    — the exact text (variables resolved), the number it goes from and to,
 *                     stored as a plan; nothing is sent;
 *   message.confirm — sends it through whatsapp-api-proxy AS THE USER — the same call the app's
 *                     chat makes, with the same guards (org boundary, the owner-only chat rule,
 *                     the strict write-instance rules for sector numbers).
 *
 * From: the number the lead already talks to (its last message), else a connected number that
 * is not reserved to a department. Many leads at once is a broadcast (broadcast.*), never this.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";
import { resolveBlastMessage } from "../../_shared/quick-blast/message-resolver.ts";
import {
  actionErrorMessage,
  type EdgeInvoker,
  isUuid,
  PLAN,
  WRITE,
  writeContext,
} from "./actions.ts";
import { leadVars, unsupportedVariables, unsupportedVariablesMessage } from "./message-vars.ts";
import { callerHasFeature } from "./rpc.ts";
import { dbErrorResult, errorResult, jsonResult, resolveOrgScope } from "./shared.ts";

export const SINGLE_MESSAGE_MAX = 2000;

interface InstanceRow {
  id: string;
  instance_name: string | null;
  phone_number: string | null;
  status: string | null;
  provider: string | null;
  reserved_for: string | null;
}

/**
 * The sending number: the one asked (must be connected), else the one of the lead's last
 * message, else the first connected one not reserved to a department. Uazapi only — the
 * official channel needs approved templates outside the 24 h window. Pure.
 */
export function pickInstance(
  rows: InstanceRow[],
  wanted: string | null,
  lastUsed: string | null,
): { ok: true; instance: InstanceRow } | { ok: false; message: string } {
  const usable = rows.filter((r) => r.status === "connected" && r.provider === "uazapi");
  if (wanted) {
    const i = usable.find((r) => r.id === wanted);
    return i ? { ok: true, instance: i } : {
      ok: false,
      message: "Esse número não está conectado (ou não é um número comum de WhatsApp).",
    };
  }
  const last = lastUsed ? usable.find((r) => r.id === lastUsed) : undefined;
  const pick = last ?? usable.find((r) => !r.reserved_for);
  return pick
    ? { ok: true, instance: pick }
    : { ok: false, message: "Nenhum número de WhatsApp conectado disponível." };
}

/** The lead's number as the provider wants it (DDI 55 when missing). Pure. */
export function waNumber(normalized: string | null, phone: string | null): string | null {
  const digits = (normalized || phone || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.startsWith("55") ? digits : `55${digits}`;
}

export const customerMessagePlanTool: ToolDef = {
  name: "message.plan",
  description:
    "Plan ONE WhatsApp message to ONE lead (for many leads use broadcast.plan). Variables " +
    "{{primeiro_nome}}, {{nome}}, {{empresa}}, {{segmento}} are filled in now; any other is " +
    "refused. Goes from the number the lead already talks to, unless instance_id is given. " +
    "Nothing is sent: returns the exact text, from/to and confirm_token. Show it to the " +
    "person; only with their OK call message.confirm.",
  readonly: false,
  customerExposed: true,
  requiredScope: "messages:send",
  annotations: { ...PLAN, title: "Plan WhatsApp message" },
  inputSchema: {
    type: "object",
    properties: {
      lead_id: { type: "string" },
      text: { type: "string", maxLength: SINGLE_MESSAGE_MAX },
      instance_id: { type: "string", description: "Sending number (whatsapp.instance_status)" },
    },
    required: ["lead_id", "text"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const w = writeContext(ctx, "messages:send");
    if (!w.ok) return w.result;
    if (!isUuid(args.lead_id)) return errorResult("lead_id must be a UUID.");
    if (args.instance_id !== undefined && !isUuid(args.instance_id)) {
      return errorResult("instance_id must be a UUID.");
    }
    const raw = typeof args.text === "string" ? args.text.trim() : "";
    if (!raw || raw.length > SINGLE_MESSAGE_MAX) {
      return errorResult(`text: 1–${SINGLE_MESSAGE_MAX} characters.`);
    }
    const unsupported = unsupportedVariables(raw);
    if (unsupported.length) return errorResult(unsupportedVariablesMessage(unsupported));
    if (!(await callerHasFeature(ctx, "whatsapp.send_messages"))) {
      return errorResult(
        "Seu usuário não pode enviar mensagens no Torque (permissão whatsapp.send_messages).",
      );
    }

    const db = ctx.db as SupabaseClient;
    const { data: leadRow, error: leadErr } = await db.from("leads")
      .select("id,name,company,segment,phone,normalized_phone")
      .eq("organization_id", scope.orgId).eq("id", args.lead_id).is("deleted_at", null)
      .maybeSingle();
    if (leadErr) return dbErrorResult(leadErr);
    if (!leadRow) return errorResult("Lead não encontrado (ou você não tem acesso a ele).");
    const lead = leadRow as {
      id: string;
      name: string | null;
      company: string | null;
      segment: string | null;
      phone: string | null;
      normalized_phone: string | null;
    };
    const number = waNumber(lead.normalized_phone, lead.phone);
    if (!number) return errorResult("Esse lead não tem um celular válido.");

    const [inst, last] = await Promise.all([
      db.from("whatsapp_instances").select(
        "id,instance_name,phone_number,status,provider,reserved_for",
      )
        .eq("organization_id", scope.orgId).limit(100),
      lead.normalized_phone
        ? db.from("whatsapp_messages").select("instance_id").eq("organization_id", scope.orgId)
          .eq("normalized_phone", lead.normalized_phone).order("timestamp", { ascending: false })
          .limit(1).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (inst.error) return dbErrorResult(inst.error);
    if (last.error) return dbErrorResult(last.error);
    const picked = pickInstance(
      (inst.data ?? []) as InstanceRow[],
      (args.instance_id as string | undefined) ?? null,
      (last.data as { instance_id: string | null } | null)?.instance_id ?? null,
    );
    if (!picked.ok) return errorResult(picked.message);

    const text = resolveBlastMessage(raw, leadVars(lead), () => 0);
    try {
      const { actionId, expiresAt } = await w.store.open(
        "message.send",
        "messages:send",
        `Mensagem para ${lead.name ?? "lead"} por ${picked.instance.instance_name ?? "WhatsApp"}`,
        { lead_id: lead.id, number, text, instance_id: picked.instance.id },
      );
      return jsonResult({
        confirm_token: actionId,
        expires_at: expiresAt,
        to: { lead: lead.name, phone: `…${number.slice(-4)}` },
        from: { id: picked.instance.id, name: picked.instance.instance_name },
        text,
        next: "Mostre o texto à pessoa. Com o OK dela, chame message.confirm (vale 5 min).",
      });
    } catch (e) {
      return errorResult(actionErrorMessage(e));
    }
  },
};

export const customerMessageConfirmTool: ToolDef = {
  name: "message.confirm",
  description:
    "Send a message planned with message.plan — only after the person approved it. It goes " +
    "out at once and cannot be unsent.",
  readonly: false,
  customerExposed: true,
  requiredScope: "messages:send",
  annotations: { ...WRITE, title: "Send WhatsApp message" },
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
    const edge = (ctx.edge as EdgeInvoker | undefined) ?? null;
    if (!edge) return errorResult("Envio indisponível neste servidor.");
    if (!isUuid(args.confirm_token)) return errorResult("confirm_token inválido.");
    if (!(await callerHasFeature(ctx, "whatsapp.send_messages"))) {
      return errorResult("Seu usuário não pode mais enviar mensagens (whatsapp.send_messages).");
    }
    const taken = await w.store.take(args.confirm_token);
    if (!taken || taken.tool !== "message.send") {
      return errorResult(
        "Plano inexistente, vencido (5 min), já usado ou sem permissão. Gere outro com message.plan.",
      );
    }
    const plan = taken.plan as {
      lead_id: string;
      number: string;
      text: string;
      instance_id: string;
    };
    const r = await edge("whatsapp-api-proxy", {
      action: "sendText",
      instance_id: plan.instance_id,
      organization_id: scope.orgId,
      payload: { number: plan.number, text: plan.text, lead_id: plan.lead_id },
    });
    const ok = r.status >= 200 && r.status < 300 && !r.body?.error;
    await w.store.finish(args.confirm_token, ok ? "applied" : "failed", {
      status: r.status,
      error: ok ? null : String(r.body?.error ?? `HTTP ${r.status}`),
    });
    return ok
      ? jsonResult({ sent: true, to: `…${plan.number.slice(-4)}`, text: plan.text })
      : errorResult(
        `O WhatsApp não aceitou o envio: ${String(r.body?.error ?? `HTTP ${r.status}`)}`,
      );
  },
};
