import type { Breadcrumb, ErrorEvent, EventHint } from "@sentry/react";
import type { AppError } from "./app-error";
import { getReportIdentity, wasReported } from "./report";
import { scrubPii, technicalSummary } from "./scrub";
import { toAppError } from "./to-app-error";

/**
 * O que sai do navegador para o Sentry, e o que não sai (ADR-0038, decisão 4).
 *
 * Funções puras sobre o formato do evento — sem o SDK, para teste. O
 * `dataCollection` do init já desliga a coleta automática (cookies, headers,
 * corpos, query string); isto é a segunda camada, e a que conhece o domínio:
 *
 * - telefone, e-mail, CPF/CNPJ mascarados em todo texto (`scrubPii`);
 * - `details`/`hint` do Postgres descartados — carregam o valor da linha;
 * - URL sem query nem fragmento: filtro do PostgREST (`?phone=eq.5511…`) e o
 *   token do Supabase Auth, que volta no `#access_token=…`; segredo no path
 *   (`/reset-password/<token>`) e caminho de arquivo do Storage trocados por
 *   marcador; URL dentro de texto livre (mensagem de erro de rede) também;
 * - rótulo visível de elemento (`aria-label`, `title`, `alt`) fora do rastro de
 *   clique — é onde mora o nome do lead ("Excluir João Silva");
 * - do usuário, só o UUID. Nome, e-mail e IP não.
 */

const DROPPED_KEYS = new Set(["details", "hint"]);
const URL_KEYS = new Set(["url", "from", "to", "description"]);
const MAX_DEPTH = 6;
const MAX_TAG_LENGTH = 200;

export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Segredo que mora no PATH, não na query — cortar a query não basta:
 * - o token de redefinição de senha é segmento de rota (`/reset-password/:token`);
 * - o caminho de objeto do Storage carrega org, lead e nome de arquivo do
 *   cliente. Fica o bucket.
 */
const SECRET_PATH_SEGMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\/reset-password\/[^/?#]+/g, "/reset-password/:token"],
  [/(\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?[^/?#]+)\/[^?#]+/g, "$1/:path"],
];

export function scrubUrl(url: string): string {
  let out = stripQuery(url);
  for (const [pattern, replacement] of SECRET_PATH_SEGMENTS) out = out.replace(pattern, replacement);
  return scrubPii(out);
}

/** URL dentro de texto livre: "error sending request for url (https://…?access_token=…)". */
const URL_IN_TEXT = /https?:\/\/[^\s"'<>()]+/g;

/** Texto livre (mensagem de exceção, rastro): URLs limpas e PII mascarada. */
export function scrubText(text: string): string {
  return scrubPii(text.replace(URL_IN_TEXT, (url) => scrubUrl(url)));
}

function scrubValue(key: string, value: unknown, depth: number): unknown {
  if (typeof value === "string") return URL_KEYS.has(key) ? scrubUrl(value) : scrubText(value);
  if (value === null || typeof value !== "object" || depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => scrubValue(key, item, depth + 1));
  return scrubRecord(value as Record<string, unknown>, depth + 1);
}

export function scrubRecord(record: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (DROPPED_KEYS.has(key)) continue;
    out[key] = scrubValue(key, value, depth);
  }
  return out;
}

const VISIBLE_LABEL_ATTRIBUTE = /\[(aria-label|title|alt|placeholder)=(?:"[^"]*"|'[^']*'|[^\]]*)\]/g;

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  // Log de console não sai. O build de produção NÃO tira `console.*` (a opção
  // no vite.config.ts está no lugar errado e é ignorada), e o que o app loga é
  // texto livre — nome de lead, objeto inteiro. O passo a passo vem de clique,
  // navegação e requisição.
  if (breadcrumb.category === "console") return null;

  const out: Breadcrumb = { ...breadcrumb };
  if (typeof out.message === "string") {
    out.message = scrubText(out.message.replace(VISIBLE_LABEL_ATTRIBUTE, "[$1]"));
  }
  if (out.data) out.data = scrubRecord(out.data);
  return out;
}

/** Tag do Sentry: até 200 caracteres, sem quebra de linha. */
function tagValue(value: string): string {
  return scrubPii(value.replace(/\s+/g, " ").trim()).slice(0, MAX_TAG_LENGTH);
}

export function tagsFor(error: AppError, context: Record<string, string>): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) tags[key.slice(0, 32)] = tagValue(value);
  tags.reference = error.reference;
  tags.error_code = error.code;
  return tags;
}

/**
 * Erro de programação no nosso código — o agrupamento padrão do Sentry, pela
 * pilha, é o certo: a mesma mensagem em dois lugares são dois defeitos.
 */
const PROGRAMMING_ERRORS = new Set(["TypeError", "ReferenceError", "RangeError", "SyntaxError", "URIError"]);

function isProgrammingError(cause: unknown): cause is Error {
  return cause instanceof Error && PROGRAMMING_ERRORS.has(cause.name) && !/fetch|network|load failed/i.test(cause.message);
}

const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function groupingKey(cause: unknown): string {
  return technicalSummary(cause).replace(UUID_LIKE, "<uuid>").replace(/\d+/g, "<n>").slice(0, 200);
}

/**
 * O resto (erro do PostgREST, da edge function, do Auth) nasce dentro da
 * biblioteca: a pilha é a mesma para toda chamada, e o Sentry juntaria "RLS em
 * leads" com "timeout em deals" num problema só. Agrupa pelo código do contrato
 * mais a mensagem técnica sem números — um problema por tabela/RPC/função.
 */
export function fingerprintFor(error: AppError, context: Record<string, string>): string[] | undefined {
  if (isProgrammingError(error.cause)) return undefined;
  return ["app-error", error.code, groupingKey(error.cause), context.source ?? ""];
}

/**
 * O que vai como exceção. A causa, quando é um `Error`, vai inteira — pilha
 * real, e o SDK a marca como já capturada (não volta pelo handler global). Se
 * não é (o erro do PostgREST é objeto simples), um `Error` com o resumo técnico.
 */
export function exceptionFor(error: AppError): Error {
  const { cause } = error;
  if (cause instanceof Error) return cause;
  const exception = new Error(`${error.code} · ${technicalSummary(cause)}`);
  const name =
    typeof cause === "object" && cause !== null && "name" in cause && typeof cause.name === "string"
      ? cause.name
      : "";
  exception.name = name || "AppError";
  return exception;
}

/**
 * O Sentry também captura sozinho (erro não tratado, rejeição sem `catch`).
 * Esses eventos passam pela mesma régua do contrato: recusa deliberada e
 * validação não viram evento, e o que a tela já relatou não vira duplicata.
 */
function isUnwantedAutoCapture(event: ErrorEvent, hint: EventHint): boolean {
  if (event.tags?.reference) return false; // veio do nosso reporter
  const original = hint.originalException;
  if (original === undefined || original === null) return false;
  if (wasReported(original)) return true;
  return !toAppError(original).reportable;
}

export function prepareEvent(event: ErrorEvent, hint: EventHint): ErrorEvent | null {
  if (isUnwantedAutoCapture(event, hint)) return null;

  if (event.message) event.message = scrubText(event.message);

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
  }

  if (event.request) {
    event.request = event.request.url ? { url: scrubUrl(event.request.url) } : {};
  }

  if (event.extra) event.extra = scrubRecord(event.extra);

  if (event.contexts) {
    // `trace` são ids hex — a máscara de dígitos os cortaria e quebraria o elo.
    const { trace, ...rest } = event.contexts;
    event.contexts = { ...(scrubRecord(rest) as typeof rest), ...(trace ? { trace } : {}) };
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  }

  const identity = getReportIdentity();
  event.user = identity?.userId ? { id: identity.userId } : undefined;
  if (identity?.organizationId || identity?.role) {
    event.tags = {
      ...event.tags,
      ...(identity.organizationId ? { organization_id: identity.organizationId } : {}),
      ...(identity.role ? { role: identity.role } : {}),
    };
  }

  return event;
}

/** `EventType` do rrweb: Meta leva o `href` da página; Custom, rastros e spans de rede. */
const RRWEB_META_EVENT = 4;
const RRWEB_CUSTOM_EVENT = 5;

/**
 * Evento da gravação de sessão (replay). O texto da tela já sai mascarado pelo
 * próprio replay (e `title`/`placeholder`/`aria-label` também, por padrão), e o
 * snapshot de DOM não é varrido aqui (é grande, e varrer a cada mutação custaria
 * caro). O que sobra com dado: o `href` da página e os eventos custom.
 */
export function scrubRecordingEvent<T>(event: T): T {
  if (typeof event !== "object" || event === null) return event;
  const { type, data } = event as { type?: unknown; data?: unknown };
  if (typeof data !== "object" || data === null) return event;
  if (type === RRWEB_META_EVENT) {
    const { href } = data as { href?: unknown };
    return typeof href === "string" ? { ...event, data: { ...data, href: scrubUrl(href) } } : event;
  }
  if (type !== RRWEB_CUSTOM_EVENT) return event;
  return { ...event, data: scrubRecord(data as Record<string, unknown>) };
}

/**
 * O evento de replay não passa pelo `beforeSend`; passa pelos event processors.
 * Ele carrega a lista de URLs visitadas e a URL da página.
 */
export function scrubReplayEvent<T extends { type?: string; urls?: string[]; request?: { url?: string } }>(event: T): T {
  if (event.type !== "replay_event") return event;
  if (event.urls) event.urls = event.urls.map(scrubUrl);
  if (event.request?.url) event.request = { url: scrubUrl(event.request.url) };
  return event;
}
