/**
 * Tradução da recusa do Supabase Auth em `auth.admin.createUser` para a
 * resposta que a edge devolve ao admin.
 *
 * Por que existe: o Auth recusa em inglês ("Password is known to be weak and
 * easy to guess…"). Repassar esse texto faz o front descartá-lo (só exibe frase
 * humana em português — `isHumanPortugueseMessage`) e mostrar erro genérico com
 * referência; o admin fica sem saber que o problema é a senha (2026-10-13).
 *
 * Contrato: `message` vai para a tela — sempre português, nunca o texto técnico
 * do Auth. O detalhe técnico fica para o log do chamador. `kind` é estável e
 * serve para telemetria.
 *
 * Ordem de decisão: `code` do AuthApiError primeiro (contrato do GoTrue), texto
 * só como fallback (versões antigas do GoTrue / erro sem code).
 */

export type AuthCreateErrorKind =
  | "weak_password"
  | "email_invalid"
  | "email_exists"
  | "rate_limited"
  | "unknown";

export interface MappedAuthCreateError {
  status: number;
  kind: AuthCreateErrorKind;
  message: string;
}

const MSG_WEAK_GENERIC =
  "Essa senha é fraca ou já apareceu em vazamentos de dados. Escolha outra, com pelo menos 12 caracteres e sem palavras óbvias.";
const MSG_WEAK_PWNED =
  "Essa senha já apareceu em vazamentos de dados. Escolha outra, com pelo menos 12 caracteres e sem palavras óbvias.";
const MSG_WEAK_LENGTH = "Essa senha é curta demais. Use pelo menos 12 caracteres.";
const MSG_WEAK_CHARACTERS =
  "Essa senha precisa misturar letras maiúsculas e minúsculas, números e símbolos.";
const MSG_EMAIL_INVALID = "E-mail inválido.";
const MSG_EMAIL_EXISTS = "Este email já está cadastrado.";
const MSG_RATE_LIMITED = "Muitas tentativas. Aguarde um minuto e tente de novo.";
const MSG_UNKNOWN = "Não foi possível criar o usuário.";

const EMAIL_EXISTS_CODES = new Set(["email_exists", "user_already_exists"]);
const RATE_LIMIT_CODES = new Set(["over_request_rate_limit", "over_email_send_rate_limit"]);

type WeakReason = "pwned" | "length" | "characters";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readReasons(err: Record<string, unknown>): Set<WeakReason> {
  const out = new Set<WeakReason>();
  const raw = err.reasons;
  if (!Array.isArray(raw)) return out;
  for (const r of raw) {
    if (r === "pwned" || r === "length" || r === "characters") out.add(r);
  }
  return out;
}

/** Motivo inferido do texto quando o Auth não manda `reasons`. */
function reasonFromText(text: string): WeakReason | null {
  if (text.includes("known to be weak") || text.includes("pwned")) return "pwned";
  if (text.includes("password should be at least")) return "length";
  if (text.includes("password should contain")) return "characters";
  return null;
}

function weak(reasons: Set<WeakReason>): MappedAuthCreateError {
  // Vazamento primeiro: é o único motivo que o admin não consegue enxergar
  // olhando a própria senha.
  const message = reasons.has("pwned")
    ? MSG_WEAK_PWNED
    : reasons.has("length")
    ? MSG_WEAK_LENGTH
    : reasons.has("characters")
    ? MSG_WEAK_CHARACTERS
    : MSG_WEAK_GENERIC;
  return { status: 422, kind: "weak_password", message };
}

export function mapAuthCreateError(err: unknown): MappedAuthCreateError {
  if (!isRecord(err)) return { status: 502, kind: "unknown", message: MSG_UNKNOWN };

  const code = typeof err.code === "string" ? err.code : "";
  const status = typeof err.status === "number" ? err.status : null;
  const text = typeof err.message === "string" ? err.message.toLowerCase() : "";
  const reasons = readReasons(err);

  // 1) code do GoTrue
  if (code === "weak_password") {
    if (reasons.size === 0) {
      const inferred = reasonFromText(text);
      if (inferred) reasons.add(inferred);
    }
    return weak(reasons);
  }
  if (code === "email_address_invalid") {
    return { status: 422, kind: "email_invalid", message: MSG_EMAIL_INVALID };
  }
  if (EMAIL_EXISTS_CODES.has(code)) {
    return { status: 409, kind: "email_exists", message: MSG_EMAIL_EXISTS };
  }
  if (RATE_LIMIT_CODES.has(code) || status === 429) {
    return { status: 429, kind: "rate_limited", message: MSG_RATE_LIMITED };
  }

  // 2) fallback pelo texto
  const textReason = reasonFromText(text);
  if (textReason) return weak(new Set([textReason]));
  if (text.includes("password") && text.includes("weak")) return weak(new Set());
  if (text.includes("invalid format") || text.includes("unable to validate email")) {
    return { status: 422, kind: "email_invalid", message: MSG_EMAIL_INVALID };
  }
  if (text.includes("already")) {
    return { status: 409, kind: "email_exists", message: MSG_EMAIL_EXISTS };
  }
  if (text.includes("rate limit")) {
    return { status: 429, kind: "rate_limited", message: MSG_RATE_LIMITED };
  }

  // 3) desconhecido: recusa do cliente (4xx) continua 400; falha do Auth ou
  // ausência de status vira 502 (o problema é a dependência, não o pedido).
  const upstreamClientError = status !== null && status >= 400 && status < 500;
  return { status: upstreamClientError ? 400 : 502, kind: "unknown", message: MSG_UNKNOWN };
}

const EMAIL_LIKE = /[^\s@"'<>()]+@[^\s@"'<>()]+/g;

/**
 * Texto técnico do Auth para o log, com e-mails mascarados (o GoTrue ecoa o
 * endereço em recusas como `Email address "x@y" is invalid`). Nunca contém a
 * senha: o Auth não a ecoa e o chamador não a passa aqui.
 */
export function authCreateErrorLogDetail(err: unknown): string {
  const raw = isRecord(err) && typeof err.message === "string" ? err.message : String(err ?? "");
  return raw.replace(EMAIL_LIKE, "[email]").slice(0, 500);
}
