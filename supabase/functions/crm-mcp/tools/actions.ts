/**
 * Write-tool plumbing (ADR 0012, emenda 3): every write is `plan` → `confirm`.
 *
 * The plan is stored server-side (crm_mcp_actions) by functions only the crm_mcp_resolver
 * role can execute, bound to the presenting token's hash. So the confirm step does not trust
 * anything the client sends back except the opaque action id: the plan it applies is the one
 * the server validated, it applies once, within 5 minutes, only for the same token, and only
 * if the scope still holds at that moment. The same rows are the audit trail an org admin
 * reads in the app; the browser can read them but never write them.
 */
import type { ToolAnnotations, ToolContext, ToolResult } from "../../_shared/mcp/types.ts";
import { errorResult } from "./shared.ts";

export type WriteScope = "crm:write" | "messages:send" | "automations:write";

export interface ActionStore {
  open(
    tool: string,
    scope: WriteScope,
    summary: string,
    plan: unknown,
  ): Promise<{ actionId: string; expiresAt: string }>;
  /** Single use: returns the stored plan once, or null (unknown/expired/used/other token/scope gone). */
  take(actionId: string): Promise<{ tool: string; plan: unknown } | null>;
  finish(
    actionId: string,
    status: "applied" | "partial" | "failed",
    result: unknown,
  ): Promise<boolean>;
  /** An applied action of this token from the last 24 h, for undo. */
  getApplied(actionId: string): Promise<{ tool: string; plan: unknown; result: unknown } | null>;
  markUndone(actionId: string): Promise<boolean>;
}

/** Annotations for a write tool: the client must ask the human before calling it. */
export const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

/** Annotations for a `*.plan` tool: it validates and stores a plan, changes no business data. */
export const PLAN: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** The store, if this request may write with `scope`; otherwise an error result. */
export function writeContext(
  ctx: ToolContext,
  scope: WriteScope,
): { ok: true; store: ActionStore } | { ok: false; result: ToolResult } {
  if (!(ctx.scopes ?? []).includes(scope)) {
    return { ok: false, result: errorResult(`Este token não tem o escopo ${scope}.`) };
  }
  const store = ctx.actions as ActionStore | undefined;
  if (!store) return { ok: false, result: errorResult("Escrita indisponível neste servidor.") };
  return { ok: true, store };
}

/** Translate the action functions' SQLSTATEs into something the person can act on. */
export function actionErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/escopo .* negado \(write_disabled\)/.test(msg)) {
    return "A escrita pela IA não está liberada para esta organização (flag crm_mcp_write).";
  }
  if (/escopo .* negado/.test(msg)) {
    return "Seu usuário não tem mais a permissão que esta ação exige.";
  }
  if (/sem o escopo/.test(msg)) return "Este token não tem o escopo necessário.";
  if (/token inválido/.test(msg)) return "Token inválido.";
  return "Não foi possível registrar a ação.";
}
