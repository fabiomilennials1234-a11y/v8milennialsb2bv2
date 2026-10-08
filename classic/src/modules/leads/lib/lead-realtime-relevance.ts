/**
 * O que um evento realtime de `leads` muda NA TELA — classificador puro.
 *
 * ── POR QUE EXISTE ────────────────────────────────────────────────────────
 * Antes, todo evento da org (e de deals, pipeline_entries, sale_events) fazia
 * a lista + seis contagens irem ao banco. A maioria dos eventos não muda nada
 * que esteja na tela: a nota de um lead da página 40, o `ai_disabled` que o
 * Copilot acabou de virar, o `updated_at` de um lead fora do recorte.
 *
 * Veredito, do mais barato ao mais caro:
 *   - `ignore`  — nada a fazer (id desconhecido num DELETE; outra org; nada
 *                 mudou de fato);
 *   - `patch`   — lead NA TELA, só colunas fora de recorte mudaram: aplica no
 *                 cache, zero consulta;
 *   - `counts`  — lead FORA da tela e provadamente depois da última linha da
 *                 página: a página não muda; as contagens talvez;
 *   - `remove`  — DELETE de lead que está em cache: tira e refaz;
 *   - `refetch` — qualquer outro caso.
 *
 * Todo "pula" tem prova. Na dúvida, refaz — o erro caro aqui é o silencioso.
 *
 * ── O QUE O REALTIME ENTREGA (e o que não) ────────────────────────────────
 * - `leads` tem REPLICA IDENTITY default: `old` traz só a PK. A comparação é
 *   contra a linha EM CACHE, não contra `old`.
 * - timestamptz chega como texto do Postgres ("2026-10-05 12:00:00.123+00"),
 *   não no ISO do PostgREST ("…T12:00:00.123+00:00"): o realtime-js não
 *   converte (transformers.js, `timestamptz` → noop). Comparar texto acusaria
 *   mudança em toda linha; gravar o texto cru quebra `new Date()` no Safari.
 *   Compara-se o instante, e grava-se normalizado.
 * - valor TOASTado que não mudou pode vir nulo. Por isso não-nulo → nulo
 *   nunca é patch: refaz.
 * - DELETE não é filtrável por org no servidor. Só age sobre id que já está no
 *   cache desta org.
 *
 * ── FORA DE ESCOPO, DE PROPÓSITO ──────────────────────────────────────────
 * Avaliar o filtro no cliente para esconder/mostrar linha duplicaria a
 * semântica do banco (`ilike`, RLS, campos calculados). Descartado.
 */
import type { LeadListSort } from "./lead-list-sort";

/**
 * Colunas que decidem QUEM está na lista, EM QUE ORDEM, ou o que vem embutido
 * por join. Mudou uma delas → a linha pode sair, entrar ou mudar de lugar, ou
 * o nome embutido ficou velho: refaz.
 *
 * Travado por teste (`tests/unit/lead-realtime-relevance.test.ts`) com um
 * builder espião sobre `applyLeadListFilters` e `applyLeadListSort`: filtro
 * novo cuja coluna não esteja aqui reprova o teste.
 */
export const LEAD_MEMBERSHIP_COLUMNS: ReadonlySet<string> = new Set([
  // Tenancy, sombra e lixeira (guardas da lista e dos cards).
  "id",
  "organization_id",
  "is_shadow",
  "deleted_at",
  // Ordem e janela de criação.
  "created_at",
  "name",
  // Busca.
  "company",
  "email",
  "phone",
  "normalized_phone",
  "erp_code",
  // Filtros.
  "origin",
  "uf",
  "qualification_tier",
  "classificacao",
  "relacao_negocios",
  "cafe_jurere_erp_elegivel",
  // Dono / atribuição — e as FKs dos joins embutidos na lista.
  "responsible_id",
  "pre_sale_responsible_id",
  "sale_responsible_id",
  "sdr_id",
  "closer_id",
]);

/**
 * Campos CALCULADOS do PostgREST usados como filtro, e as colunas de `leads`
 * de que dependem. O que vem de outras tabelas (negócios, entradas de funil)
 * não passa por aqui: chega por outra assinatura.
 */
export const LEAD_COMPUTED_FIELD_INPUTS: Readonly<Record<string, readonly string[]>> = {
  visivel_lista_cafe_jurere: ["organization_id", "erp_code", "cafe_jurere_erp_elegivel"],
  classificacao_cafe_jurere: ["organization_id", "erp_code", "id"],
};

/** Embutidos pela consulta da lista — o realtime não os traz e o patch não os toca. */
const JOINED_FIELDS = new Set(["responsible", "sdr", "closer", "pre_sale_responsible", "sale_responsible", "lead_tags"]);

/**
 * De onde vem a coluna "Relação" da página:
 *   - `relacao` — `leads.relacao_negocios` (gravada por trigger): é recorte;
 *   - `erp` — a página não usa a relação (fica `undefined`);
 *   - `cafe` — a página mostra `classificacao_cafe_jurere` no mesmo campo.
 * Nos dois últimos o valor em cache NÃO é a coluna; comparar acusaria mudança
 * falsa, e gravar trocaria o que a tela mostra.
 */
export type LeadRelacaoMode = "relacao" | "erp" | "cafe";

export interface LeadEventContext {
  organizationId: string | null | undefined;
  /** A página que ESTA tela está mostrando (cache da chave ativa). */
  rows: ReadonlyArray<Record<string, unknown>> | undefined;
  pageSize: number;
  sort: LeadListSort;
  mode: LeadRelacaoMode;
  /** O id está em alguma página em cache desta org? (decide o DELETE) */
  isCached: (id: string) => boolean;
}

export type LeadEventVerdict =
  | { kind: "ignore" }
  | { kind: "patch"; id: string; changes: Record<string, unknown> }
  | { kind: "counts" }
  | { kind: "remove"; id: string }
  | { kind: "refetch" };

interface LeadRealtimePayload {
  eventType: "INSERT" | "UPDATE" | "DELETE" | string;
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
  errors?: unknown;
}

const IGNORE: LeadEventVerdict = { kind: "ignore" };
const REFETCH: LeadEventVerdict = { kind: "refetch" };

export function classifyLeadEvent(payload: LeadRealtimePayload, ctx: LeadEventContext): LeadEventVerdict {
  if (payload.eventType === "DELETE") {
    const id = payload.old?.id;
    if (typeof id !== "string" || !ctx.isCached(id)) return IGNORE;
    return { kind: "remove", id };
  }
  if (payload.eventType !== "INSERT" && payload.eventType !== "UPDATE") return REFETCH;

  const incoming = payload.new;
  const id = incoming?.id;
  if (!incoming || typeof id !== "string") return REFETCH;
  // O servidor já filtra INSERT/UPDATE por org. Linha de outra org nunca vira
  // patch — defesa em profundidade no único caminho que escreve no cache.
  if (incoming.organization_id != null && incoming.organization_id !== ctx.organizationId) return IGNORE;
  if (hasErrors(payload.errors)) return REFETCH;

  const cached = ctx.rows?.find((row) => row.id === id);
  if (cached) {
    if (payload.eventType === "INSERT") return REFETCH;
    return diffOnScreen(cached, incoming, ctx.mode);
  }
  return positionOffScreen(incoming, ctx);
}

function hasErrors(errors: unknown): boolean {
  if (errors == null) return false;
  return Array.isArray(errors) ? errors.length > 0 : true;
}

function diffOnScreen(
  cached: Record<string, unknown>,
  incoming: Record<string, unknown>,
  mode: LeadRelacaoMode,
): LeadEventVerdict {
  const changes: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(incoming)) {
    if (JOINED_FIELDS.has(column)) continue;
    if (column === "relacao_negocios" && mode !== "relacao") continue;

    const before = cached[column];
    if (sameLeadValue(before, value)) continue;
    if (LEAD_MEMBERSHIP_COLUMNS.has(column)) return REFETCH;
    if (before != null && value == null) return REFETCH;
    if (before != null && value != null && kindOf(before) !== kindOf(value)) return REFETCH;
    changes[column] = typeof value === "string" ? normalizePgTimestamp(value) : value;
  }
  if (Object.keys(changes).length === 0) return IGNORE;
  return { kind: "patch", id: String(incoming.id), changes };
}

function kindOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Lead fora da tela: a página só fica intacta se ele está ESTRITAMENTE depois
 * da última linha — então nem entrar, nem sair, nem mudar de lugar mexe nela.
 * Só ordem por data: ordem por nome depende da collation do Postgres, que o
 * JS não reproduz.
 */
function positionOffScreen(incoming: Record<string, unknown>, ctx: LeadEventContext): LeadEventVerdict {
  const rows = ctx.rows;
  if (ctx.sort.key !== "created_at") return REFETCH;
  if (!rows || rows.length < ctx.pageSize || rows.length === 0) return REFETCH;

  const last = instantMs(rows[rows.length - 1].created_at);
  const event = instantMs(incoming.created_at);
  if (last === null || event === null) return REFETCH;
  // Empate no milissegundo: o desempate real é no µs e depois por id — refaz.
  const after = ctx.sort.direction === "desc" ? event < last : event > last;
  return after ? { kind: "counts" } : REFETCH;
}

// ── Timestamps ─────────────────────────────────────────────────────────────

const PG_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

function normalizeOffset(tz: string | undefined): string {
  if (!tz) return "";
  if (tz === "Z") return "+00:00";
  const sign = tz[0];
  const digits = tz.slice(1).replace(":", "");
  return `${sign}${digits.slice(0, 2)}:${(digits.slice(2) || "00").padEnd(2, "0")}`;
}

/**
 * Texto de timestamp do Postgres → o formato do PostgREST, sem perder o µs
 * (o `updated_at` do lock otimista compara por igualdade no banco). Qualquer
 * outra string volta intacta.
 */
export function normalizePgTimestamp(value: string): string {
  const m = PG_TIMESTAMP.exec(value);
  if (!m) return value;
  const [, date, time, fraction = "", tz] = m;
  return `${date}T${time}${fraction}${normalizeOffset(tz)}`;
}

/** Instante com precisão de µs, como texto comparável; `null` se não é timestamp com fuso. */
function instantKey(value: string): string | null {
  const m = PG_TIMESTAMP.exec(value);
  if (!m || !m[4]) return null;
  const [, date, time, fraction = "", tz] = m;
  const seconds = Date.parse(`${date}T${time}${normalizeOffset(tz)}`);
  if (Number.isNaN(seconds)) return null;
  return `${seconds}.${fraction.slice(1).padEnd(9, "0")}`;
}

function instantMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(normalizePgTimestamp(value));
  return Number.isNaN(ms) ? null : ms;
}

// ── Igualdade por significado ──────────────────────────────────────────────

/** Mesmo valor para a tela? Instante por instante; jsonb por conteúdo. */
export function sameLeadValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "string" && typeof b === "string") {
    const ka = instantKey(a);
    const kb = instantKey(b);
    return ka !== null && ka === kb;
  }
  if (typeof a === "object" && typeof b === "object") return deepEqual(a, b);
  return false;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
}

// ── Aplicação no cache ─────────────────────────────────────────────────────

/** Aplica as colunas mudadas na linha `id`; joins e relação ficam como estão. */
export function applyLeadChanges<R extends { id?: unknown }>(
  rows: R[],
  id: string,
  changes: Record<string, unknown>,
): R[] {
  if (!rows.some((row) => row.id === id)) return rows;
  return rows.map((row) => (row.id === id ? { ...row, ...changes } : row));
}

/** Tira a linha `id` (DELETE de lead que estava na tela). */
export function removeLead<R extends { id?: unknown }>(rows: R[], id: string): R[] {
  if (!rows.some((row) => row.id === id)) return rows;
  return rows.filter((row) => row.id !== id);
}
