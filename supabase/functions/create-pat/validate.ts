/** Pure request validation + refusal copy for create-pat (unit-tested in validate.test.ts). */

export interface CreateBody {
  name?: unknown;
  organization_id?: unknown;
  expires_in_days?: unknown;
  scopes?: unknown;
}

/** Scopes a token may carry. `read` is always included. */
export const KNOWN_SCOPES = ["read", "crm:write", "messages:send", "automations:write"] as const;

/** The validity presets the UI offers; the DB caps at 366 days regardless. */
export const EXPIRY_PRESETS = [7, 30, 90, 180, 366] as const;
export const DEFAULT_EXPIRY_DAYS = 90;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCreateBody(
  body: CreateBody,
):
  | {
    ok: true;
    value: { name: string; organizationId: string; expiresInDays: number; scopes: string[] };
  }
  | { ok: false; message: string } {
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (!name) return { ok: false, message: "Dê um nome ao token (ex.: Claude do notebook)." };
  if (name.length > 80) return { ok: false, message: "Nome com no máximo 80 caracteres." };

  const organizationId = typeof body.organization_id === "string"
    ? body.organization_id.trim()
    : "";
  if (!UUID_RE.test(organizationId)) return { ok: false, message: "Organização inválida." };

  const raw = body.expires_in_days;
  const days = raw === undefined || raw === null ? DEFAULT_EXPIRY_DAYS : Number(raw);
  if (!(EXPIRY_PRESETS as readonly number[]).includes(days)) {
    return { ok: false, message: `Validade deve ser uma de: ${EXPIRY_PRESETS.join(", ")} dias.` };
  }

  let scopes: string[] = ["read"];
  if (body.scopes !== undefined && body.scopes !== null) {
    if (!Array.isArray(body.scopes) || !body.scopes.every((x) => typeof x === "string")) {
      return { ok: false, message: "Escopos inválidos." };
    }
    const unknown = body.scopes.filter((x) => !(KNOWN_SCOPES as readonly string[]).includes(x));
    if (unknown.length) {
      return { ok: false, message: `Escopo desconhecido: ${unknown.join(", ")}.` };
    }
    scopes = [...new Set(["read", ...body.scopes as string[]])];
  }

  return { ok: true, value: { name, organizationId, expiresInDays: days, scopes } };
}

/** What the person sees when issuance is refused — the reason is their own state. */
export function refusalMessage(reason: string): string {
  // Scope refusals come as "<motivo>:<escopo>" from crm_mcp_issue_check.
  const [base] = reason.split(":");
  if (base === "write_disabled") {
    return "A IA ainda não pode alterar dados nesta organização (escrita não liberada).";
  }
  if (base === "scope_admin_only") {
    return "Só administradores podem dar à IA permissão de enviar mensagens.";
  }
  if (base === "scope_permission") {
    return "Você não tem no Torque a permissão que esse acesso exige.";
  }
  switch (reason) {
    case "org_disabled":
      return "O acesso por IA ainda não está liberado para esta organização.";
    case "org_blocked":
      return "A organização está com o acesso bloqueado.";
    case "not_member":
      return "Você não é membro ativo desta organização.";
    case "master_principal":
      return "Contas master não emitem token de cliente — a operação usa o MCP interno.";
    case "pat_limit":
      return "Você já tem 10 tokens ativos nesta organização. Revogue um para criar outro.";
    case "unauthenticated":
      return "Sessão inválida.";
    default:
      return "Não foi possível criar o token.";
  }
}
