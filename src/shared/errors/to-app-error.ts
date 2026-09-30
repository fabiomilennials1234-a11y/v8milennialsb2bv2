import type { AppError, ErrorCode } from "./app-error";
import { ERROR_CATALOG } from "./catalog";

/**
 * Normalizador único: qualquer coisa lançada → `AppError` (ADR-0038).
 *
 * Puro e síncrono. Não lê corpo de `Response` — o corpo de erro de uma edge
 * function entra por `unwrapFunctionsError` (assíncrono), que devolve um
 * `FunctionsErrorBody` que este módulo entende.
 *
 * Regra que não se negocia: `userMessage` nunca carrega texto técnico. A
 * mensagem original só chega à tela quando é uma frase humana em português
 * (`isHumanPortugueseMessage`) — a recusa que uma RPC ou edge function escreveu
 * para o usuário, como "funil não encontrado". Todo o resto (inglês do Postgres,
 * identificador de máquina, invariante interno) vira a mensagem do catálogo ou o
 * fallback do chamador, e a causa segue intacta em `cause`.
 */

export const DEFAULT_FALLBACK = "Não foi possível concluir a ação.";

/** Corpo de erro de edge function já lido por `unwrapFunctionsError`. */
export interface FunctionsErrorBody {
  readonly kind: "functions_error_body";
  status: number;
  /** `error` ou `message` do corpo JSON, se houver. */
  message: string;
  /** `code` do corpo, quando a função segue o envelope do ADR-0038. */
  code: string | null;
  original: unknown;
}

export function isFunctionsErrorBody(value: unknown): value is FunctionsErrorBody {
  return isRecord(value) && value.kind === "functions_error_body";
}

// ─── Frase humana em português ──────────────────────────────────────────────

const PT_WORDS =
  /(?<!\p{L})(não|nao|você|voce|apenas|pelo|pela|uma|um|para|deve|precisa|já|está|são|sao|só|seu|sua|este|esta|esse|essa|ainda|mais|sem|com|foi|ser|pode|nenhum|nenhuma|antes|depois|ao|aos|da|dos|das|na|por|máximo|maximo|mínimo|minimo|obrigatório|obrigatorio|de|em|que|ou|os|o|e|num|numa|deste|desta|podem|somente|todas|todos|entre)(?![\p{L}-])/giu;
const PT_ACCENT = /[ãõáéíóúâêôçà]/i;
const SNAKE_CASE = /\b[a-z0-9]+_[a-z0-9_]+\b/i;
/** `metrics.view`, `commissions.source`: identificador, não frase. */
const DOTTED_IDENTIFIER = /\b[a-z]+\.[a-z_]+\b/i;
/** Guardas de migration e SQL: escritos para quem aplica, não para o cliente. */
const OPERATOR_TEXT = /^(fail|falha|guarda)\s*:|^dinheiro\b|scrum[-\s]?\d|#\d|\bdeploy\b|\bsonda\b/i;
const SQL_KEYWORD = /\b(DELETE|UPDATE|INSERT|SELECT|CREATE|DROP|ALTER|GRANT|REVOKE|EXECUTE|DEFINER)\b/;
const TECHNICAL = new RegExp(
  [
    "violates",
    "constraint",
    "relation ",
    "column ",
    "syntax",
    "null value",
    "duplicate key",
    "permission denied",
    "row-level",
    "\\bpolicy\\b",
    "\\bjson\\b",
    "\\bjwt\\b",
    "pgrst",
    "function ",
    "schema",
    "typeerror",
    "referenceerror",
    "error:",
    "undefined",
    "\\bnull\\b",
    "\\bstack\\b",
    "adr-\\d",
    "append-only",
    "edge function",
    "status code",
    "https?://",
  ].join("|"),
  "i",
);

/**
 * `true` quando o texto foi escrito para uma pessoa, em português, e pode ir para
 * a tela como está.
 *
 * É uma ponte até o catálogo por domínio (Passo 3 da spec): hoje há 745 frases
 * em `RAISE EXCEPTION` e dezenas de corpos de edge function em PT que dizem o
 * motivo real da recusa. Jogá-las fora transforma recusa acionável em mistério
 * (memória `erro-do-supabase-nao-e-instanceof-error`). O filtro é estrito de
 * propósito: na dúvida, recusa — o catálogo cobre o resto.
 */
export function isHumanPortugueseMessage(message: string): boolean {
  const text = message.trim();
  if (text.length < 6 || text.length > 220) return false;
  if (SNAKE_CASE.test(text)) return false;
  if (DOTTED_IDENTIFIER.test(text)) return false;
  if (OPERATOR_TEXT.test(text)) return false;
  if (SQL_KEYWORD.test(text)) return false;
  if (TECHNICAL.test(text)) return false;
  if (/[%{}<=`\\]/.test(text)) return false;
  // `>` só é humano como separador de menu ("Configurações > WhatsApp");
  // colado em algo (`->`, `a>b`, tag) é código.
  if (/\S>|>\S/.test(text)) return false;
  // Prefixo PT com cauda inglesa ("Erro ao enviar áudio: The object exceeded
  // the maximum allowed size") não é frase humana — o acento enganaria.
  if (ENGLISH_WORDS.test(text)) return false;

  if (PT_ACCENT.test(text)) return true;
  const matches = text.match(PT_WORDS);
  const ptCount = matches?.length ?? 0;
  if (ptCount >= 2) return true;

  // Frase sem acento com um só sinal ("Comprador incompleto: nome, e-mail e
  // documento fiscal andam juntos" — só o `e`; "Sem acesso") ainda é humana se
  // tiver mais de uma palavra (a palavra inglesa já foi recusada acima).
  const words = text.match(/\p{L}+/gu) ?? [];
  return ptCount === 1 && words.length >= 2;
}

/** Palavras que denunciam texto em inglês — mensagem de lib, driver ou runtime. */
const ENGLISH_WORDS =
  /\b(the|is|are|was|not|found|of|to|with|has|have|does|did|exist|exists|required|must|cannot|can't|could|invalid|failed|failure|error|denied|unauthorized|forbidden|already|only|null|row|rows|table|when|while|unable|unexpected|missing|expected|attempting|request|response|timeout|object|value|type)\b/i;

const UUID_PARENTHETICAL = /\s*\([^()]*\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b[^()]*\)/gi;

/**
 * "forbidden: apenas admin da organização ajusta estas configurações" — o
 * prefixo é da máquina (e é ele que classifica o código); a frase depois dele é
 * para a pessoa. Tira o prefixo antes de julgar a frase.
 */
const MACHINE_PREFIX = /^(forbidden|unauthorized|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)\s*:\s+/i;

function stripMachinePrefix(message: string): string {
  return message.replace(MACHINE_PREFIX, "");
}

function joinSentences(first: string, second: string): string {
  return /[.!?…]$/.test(first) ? `${first} ${second}` : `${first}. ${second}`;
}

/** "…andam juntos (link 3f2a…)" → "…andam juntos": o id não diz nada ao cliente. */
function polish(message: string): string {
  const text = message.replace(UUID_PARENTHETICAL, "").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ─── Leitura da causa ───────────────────────────────────────────────────────

interface Reading {
  message: string;
  /** `HINT` do Postgres — no nosso banco é orientação ao usuário, em PT. */
  hint: string;
  sqlstate: string | null;
  status: number | null;
  authCode: string | null;
  /** O backend recusou de propósito (RAISE, corpo de edge fn, auth). */
  deliberate: boolean;
  forcedCode: ErrorCode | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const NETWORK_MESSAGE =
  /failed to fetch|networkerror|load failed|network request failed|err_network|err_internet_disconnected|fetcherror/i;

function read(error: unknown): Reading {
  const base: Reading = {
    message: "",
    hint: "",
    sqlstate: null,
    status: null,
    authCode: null,
    deliberate: false,
    forcedCode: null,
  };

  if (typeof error === "string") return { ...base, message: error.trim() };
  if (!isRecord(error)) return base;

  if (isFunctionsErrorBody(error)) {
    return {
      ...base,
      message: error.message,
      status: error.status,
      // Uma edge function que respondeu 4xx decidiu recusar. 5xx é defeito.
      deliberate: error.status >= 400 && error.status < 500,
      // Envelope do ADR-0038: o `code` que a função declarou vence o status.
      forcedCode: error.code && isErrorCode(error.code) ? error.code : null,
    };
  }

  const name = str(error.name);
  const message = str(error.message);

  if ("__isAuthError" in error) {
    if (name === "AuthRetryableFetchError") return { ...base, message, forcedCode: "network.offline" };
    if (name === "AuthSessionMissingError") return { ...base, message, forcedCode: "auth.session_expired" };
    return {
      ...base,
      message,
      authCode: str(error.code) || null,
      status: typeof error.status === "number" ? error.status : null,
      deliberate: true,
    };
  }

  if (name === "FunctionsFetchError") return { ...base, message, forcedCode: "network.offline" };
  if (name === "FunctionsRelayError") return { ...base, message, forcedCode: "server.unavailable" };
  if (name === "FunctionsHttpError") {
    const context = error.context;
    const status = isRecord(context) && typeof context.status === "number" ? context.status : null;
    return { ...base, message, status, deliberate: status !== null && status < 500 };
  }

  if (name === "AbortError" || name === "TimeoutError") {
    return { ...base, message, forcedCode: "request.timeout" };
  }

  // PostgrestError: devolvido como objeto simples por `{ data, error }`, ou como
  // classe quando `throwOnError()`. Reconhece pelos campos, não pela classe.
  const sqlstate = str(error.code);
  if ("code" in error && ("details" in error || "hint" in error)) {
    // `details` fica de fora de propósito: carrega o valor da linha
    // (`Key (phone)=(5511…) already exists`) — dado de lead, não orientação.
    return { ...base, message, hint: str(error.hint), sqlstate: sqlstate || null };
  }

  return { ...base, message };
}

// ─── Classificação ──────────────────────────────────────────────────────────

/** Mensagem que é um identificador de máquina: `access_denied`, `forbidden: …`. */
function machineToken(message: string): string | null {
  const match = /^([a-z][a-z0-9]*(?:_[a-z0-9]+)*)(?::.*)?$/.exec(message);
  if (!match) return null;
  const token = match[1];
  // Uma palavra solta ("error", "failed") não é identificador; exigimos `_` ou
  // um dos verbos de recusa conhecidos.
  if (!token.includes("_") && !/^(forbidden|unauthorized|conflict)$/.test(token)) return null;
  return token;
}

function codeFromToken(token: string): ErrorCode | null {
  if (/denied|^forbidden|^unauthorized/.test(token)) return "permission.denied";
  if (/not_found$|unavailable$/.test(token)) return "record.not_found";
  if (/conflict|^stale_/.test(token)) return "conflict.stale";
  if (/rate_limit/.test(token)) return "rate.limited";
  if (/^invalid|_invalid|malformed|required|too_short|too_long/.test(token)) return "validation.invalid";
  return null;
}

function codeFromStatus(status: number): ErrorCode | null {
  if (status === 0) return "network.offline";
  if (status === 400 || status === 422) return "validation.invalid";
  if (status === 401) return "auth.session_expired";
  if (status === 403) return "permission.denied";
  if (status === 404 || status === 410) return "record.not_found";
  if (status === 408 || status === 504) return "request.timeout";
  if (status === 409) return "conflict.stale";
  if (status === 429) return "rate.limited";
  if (status >= 500) return "server.unavailable";
  return null;
}

const SQLSTATE: Record<string, ErrorCode> = {
  "42501": "permission.denied",
  PGRST301: "auth.session_expired",
  PGRST302: "auth.session_expired",
  PGRST303: "auth.session_expired",
  PGRST116: "record.not_found",
  "23505": "record.duplicate",
  "23502": "validation.invalid",
  "23514": "validation.invalid",
  "22P02": "validation.invalid",
  "22023": "validation.invalid",
  "22001": "validation.invalid",
  "22003": "validation.invalid",
  "22007": "validation.invalid",
  "22008": "validation.invalid",
  "40001": "conflict.stale",
  "40P01": "conflict.stale",
  "57014": "request.timeout",
  "53300": "server.unavailable",
  "53400": "server.unavailable",
  "57P01": "server.unavailable",
  "57P03": "server.unavailable",
  PGRST000: "server.unavailable",
  PGRST001: "server.unavailable",
  PGRST002: "server.unavailable",
  PGRST003: "server.unavailable",
};

function codeFromSqlstate(sqlstate: string, message: string): ErrorCode | null {
  // FK: apagar o que tem dependente é "em uso"; inserir apontando para o que
  // sumiu é "não encontrado".
  if (sqlstate === "23503") {
    return /update or delete on table/i.test(message) ? "record.in_use" : "record.not_found";
  }
  // `ERRCODE = 'PT422'` → o PostgREST responde com esse status HTTP.
  const custom = /^PT(\d{3})$/.exec(sqlstate);
  if (custom) return codeFromStatus(Number(custom[1]));
  if (SQLSTATE[sqlstate]) return SQLSTATE[sqlstate];
  if (sqlstate.startsWith("08")) return "server.unavailable";
  return null;
}

const AUTH_CODES: Record<string, ErrorCode> = {
  invalid_credentials: "auth.invalid_credentials",
  email_not_confirmed: "auth.email_not_confirmed",
  weak_password: "auth.weak_password",
  user_already_exists: "auth.user_exists",
  email_exists: "auth.user_exists",
  session_expired: "auth.session_expired",
  session_not_found: "auth.session_expired",
  refresh_token_not_found: "auth.session_expired",
  refresh_token_already_used: "auth.session_expired",
  bad_jwt: "auth.session_expired",
  no_authorization: "auth.session_expired",
  over_request_rate_limit: "rate.limited",
  over_email_send_rate_limit: "rate.limited",
  over_sms_send_rate_limit: "rate.limited",
};

function isErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CATALOG, value);
}

function classify(r: Reading): { code: ErrorCode; deliberate: boolean } {
  if (r.forcedCode) return { code: r.forcedCode, deliberate: r.deliberate };

  if (r.authCode && AUTH_CODES[r.authCode]) return { code: AUTH_CODES[r.authCode], deliberate: true };

  const token = machineToken(r.message);
  const fromToken = token ? codeFromToken(token) : null;
  // Identificador de máquina = alguém escreveu a recusa de propósito.
  const deliberate = r.deliberate || token !== null || r.sqlstate === "P0001" || /^PT\d{3}$/.test(r.sqlstate ?? "");

  if (fromToken) return { code: fromToken, deliberate };
  if (r.sqlstate) {
    const fromSql = codeFromSqlstate(r.sqlstate, r.message);
    if (fromSql) return { code: fromSql, deliberate };
  }
  if (r.status !== null) {
    const fromStatus = codeFromStatus(r.status);
    if (fromStatus) return { code: fromStatus, deliberate };
  }
  if (NETWORK_MESSAGE.test(r.message)) return { code: "network.offline", deliberate: false };
  if (/^AbortError|timed out/i.test(r.message)) return { code: "request.timeout", deliberate: false };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { code: "network.offline", deliberate: false };
  }
  return { code: "unknown", deliberate };
}

// ─── Relatório ──────────────────────────────────────────────────────────────

/** Nunca viram evento: são o sistema funcionando, não defeito. */
const NEVER_REPORT = new Set<ErrorCode>([
  "auth.session_expired",
  "auth.invalid_credentials",
  "auth.email_not_confirmed",
  "auth.weak_password",
  "auth.user_exists",
  "network.offline",
  "rate.limited",
  "record.duplicate",
  "conflict.stale",
]);

/** Sempre viram evento: o problema é do nosso lado. */
const ALWAYS_REPORT = new Set<ErrorCode>(["server.unavailable", "request.timeout"]);

function isReportable(code: ErrorCode, deliberate: boolean): boolean {
  if (NEVER_REPORT.has(code)) return false;
  if (ALWAYS_REPORT.has(code)) return true;
  // O resto depende de quem recusou. Uma RPC que lança `access_denied` está
  // funcionando; o Postgres respondendo "violates row-level security policy" a
  // uma ação que a tela deixou fazer é defeito de policy ou de tela. É a classe
  // de erro que o `catch` genérico escondia (memória
  // `organizations-sem-update-para-admin`) — essa tem que virar evento.
  return !deliberate;
}

// ─── Referência ─────────────────────────────────────────────────────────────

const references = new WeakMap<object, string>();
const produced = new WeakSet<object>();

function mintReference(): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  return uuid.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** A mesma causa recebe sempre a mesma referência. */
export function referenceFor(cause: unknown): string {
  if (!isRecord(cause)) return mintReference();
  const existing = references.get(cause);
  if (existing) return existing;
  const minted = mintReference();
  references.set(cause, minted);
  return minted;
}

export function isAppError(value: unknown): value is AppError {
  return isRecord(value) && produced.has(value);
}

// ─── Entrada pública ────────────────────────────────────────────────────────

/**
 * Converte qualquer erro em `AppError`.
 *
 * @param fallback mensagem PT do chamador para quando nada mais específico se
 *   aplica — escrita do ponto de vista do usuário ("Não foi possível mover o
 *   card."), nunca técnica.
 */
export function toAppError(error: unknown, fallback: string = DEFAULT_FALLBACK): AppError {
  if (isAppError(error)) return error;

  const reading = read(error);
  const { code, deliberate } = classify(reading);
  const entry = ERROR_CATALOG[code];

  const candidate = stripMachinePrefix(reading.message);
  const humanMessage = candidate && isHumanPortugueseMessage(candidate) ? polish(candidate) : null;
  // `RAISE … USING HINT = 'Abra o card e preencha o valor da venda.'` diz o que
  // fazer. Vem depois da frase principal, ou sozinho quando ela é técnica.
  const humanHint = reading.hint && isHumanPortugueseMessage(reading.hint) ? polish(reading.hint) : null;
  const human = humanMessage && humanHint ? joinSentences(humanMessage, humanHint) : (humanMessage ?? humanHint);
  const safeFallback = fallback.trim() || DEFAULT_FALLBACK;
  const userMessage = human ?? entry.message ?? safeFallback;
  // Frase humana é recusa escrita de propósito, mesmo sem código de máquina.
  const wasDeliberate = deliberate || human !== null;

  const cause = isFunctionsErrorBody(error) ? error.original : error;

  const appError: AppError = {
    code,
    userMessage,
    action: entry.action,
    reference: referenceFor(cause),
    retryable: entry.retryable,
    reportable: isReportable(code, wasDeliberate),
    cause,
  };
  produced.add(appError);
  return appError;
}

/**
 * Só a mensagem, para quem mostra o erro inline em vez de toast:
 * `setErro(userMessageOf(err, "Não foi possível salvar o nome."))`.
 */
export function userMessageOf(error: unknown, fallback: string = DEFAULT_FALLBACK): string {
  return toAppError(error, fallback).userMessage;
}
