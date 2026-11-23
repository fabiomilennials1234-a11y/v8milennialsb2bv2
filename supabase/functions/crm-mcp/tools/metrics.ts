/**
 * Metrics (fatia 1 do v2): `metrics.catalog` and `metrics.query`.
 *
 * Numbers come from the SAME engine as the app's Métricas screen — fn_metric_measure over
 * the metric catalog — so what the AI reports matches what the user sees in Torque. The
 * engine is SECURITY DEFINER and authorizes the caller with assert_org_access; it is reached
 * only through the RPC allowlist (rpc.ts). The app gates the screen with the `metrics.view`
 * feature permission in the browser only; here it is enforced server-side.
 *
 * CAC has no engine measure (the app computes it in the browser from the investment typed in
 * Métricas › Marketing). It is derived here with an explicit definition — investment ÷ number
 * of sales — and says so, including when there is no investment to divide.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";
import { callerHasFeature, callRpc } from "./rpc.ts";
import {
  dbErrorResult,
  errorResult,
  jsonResult,
  optionalUuid,
  READ_ONLY,
  resolveOrgScope,
} from "./shared.ts";

// --- catalog --------------------------------------------------------------------------

export interface CatalogMeasure {
  id: string;
  label: string;
  unit: string;
  description?: string | null;
  compatible_recortes: string[];
}
export interface CatalogRatio {
  id: string;
  label: string;
  num: string;
  den: string;
  unit: string;
}
export interface Catalog {
  measures: CatalogMeasure[];
  ratios: CatalogRatio[];
  recortes: Array<{ id: string; label: string }>;
}

export const CAC = {
  id: "cac",
  label: "CAC (custo de aquisição por venda)",
  unit: "currency",
  definition:
    "Investimento de marketing cadastrado em Métricas › Marketing (por origem e mês, rateado " +
    "pelos dias do período) ÷ número de vendas do período. Gasto do Meta Ads não é guardado " +
    "no Torque e não entra. Sem investimento cadastrado, o CAC fica indisponível — nunca zero.",
} as const;

export const ALLOWED_FILTERS = [
  "pipeline_id",
  "member_id",
  "origin",
  "tag_id",
  "product_id",
  "stream",
] as const;
const UUID_FILTERS = new Set(["pipeline_id", "member_id", "tag_id", "product_id"]);
export const MAX_METRICS = 8;

// The catalog is global (same for every org) and changes only with a migration.
let catalogCache: { at: number; value: Catalog } | null = null;
const CATALOG_TTL_MS = 5 * 60_000;

async function loadCatalog(ctx: ToolContext): Promise<Catalog | { error: string }> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.value;
  const { data, error } = await callRpc<Catalog>(ctx, "fn_metric_catalog", {});
  if (error || !data) return { error: error?.message ?? "catálogo vazio" };
  const value: Catalog = {
    measures: data.measures ?? [],
    ratios: data.ratios ?? [],
    recortes: data.recortes ?? [],
  };
  catalogCache = { at: Date.now(), value };
  return value;
}

/** Test seam: forget the cached catalog. */
export function _resetCatalogCache(): void {
  catalogCache = null;
}

// --- period (pure) --------------------------------------------------------------------

export type PeriodName = "today" | "week" | "month" | "quarter" | "year" | "range";

/** What fn_metric_measure takes: day|week|month with a ref date, or a closed range. */
export interface EnginePeriod {
  period: "day" | "week" | "month" | "range";
  ref: string | null;
  start: string | null;
  end: string | null; // inclusive (the engine adds one day)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(s: string, n: number): string {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}
function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}
function validDate(s: unknown): s is string {
  return typeof s === "string" && DATE_RE.test(s) && fmt(toDate(s)) === s;
}

/** Inclusive local-date bounds of an engine period (mirrors metric_period_bounds). */
export function periodDates(p: EnginePeriod): { start: string; end: string } {
  if (p.period === "range") return { start: p.start!, end: p.end! };
  const ref = p.ref!;
  if (p.period === "day") return { start: ref, end: ref };
  if (p.period === "week") {
    const dow = (toDate(ref).getUTCDay() + 6) % 7; // Monday = 0
    const start = addDays(ref, -dow);
    return { start, end: addDays(start, 6) };
  }
  const d = toDate(ref);
  const start = fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
  const end = fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  return { start, end };
}

export const MAX_RANGE_DAYS = 731;

/** Today in the org's timezone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function resolvePeriod(
  args: Record<string, unknown>,
  today: string,
):
  | { ok: true; name: PeriodName; current: EnginePeriod; previous: EnginePeriod }
  | { ok: false; message: string } {
  const name = (typeof args.period === "string" ? args.period : "month") as PeriodName;
  const rawRef = args.ref === undefined || args.ref === null || args.ref === "" ? today : args.ref;
  // 'range' is defined by start/end alone; every other period is anchored on ref.
  if (name !== "range" && !validDate(rawRef)) {
    return { ok: false, message: "ref must be a date YYYY-MM-DD." };
  }
  const ref = rawRef as string;

  switch (name) {
    case "today":
      return {
        ok: true,
        name,
        current: { period: "day", ref, start: null, end: null },
        previous: { period: "day", ref: addDays(ref, -1), start: null, end: null },
      };
    case "week":
      return {
        ok: true,
        name,
        current: { period: "week", ref, start: null, end: null },
        previous: { period: "week", ref: addDays(ref, -7), start: null, end: null },
      };
    case "month": {
      const first = periodDates({ period: "month", ref, start: null, end: null }).start;
      return {
        ok: true,
        name,
        current: { period: "month", ref, start: null, end: null },
        previous: { period: "month", ref: addDays(first, -1), start: null, end: null },
      };
    }
    case "quarter": {
      const d = toDate(ref);
      const q0 = Math.floor(d.getUTCMonth() / 3) * 3;
      const start = fmt(new Date(Date.UTC(d.getUTCFullYear(), q0, 1)));
      const end = fmt(new Date(Date.UTC(d.getUTCFullYear(), q0 + 3, 0)));
      const pStart = fmt(new Date(Date.UTC(d.getUTCFullYear(), q0 - 3, 1)));
      const pEnd = addDays(start, -1);
      return {
        ok: true,
        name,
        current: { period: "range", ref: null, start, end },
        previous: { period: "range", ref: null, start: pStart, end: pEnd },
      };
    }
    case "year": {
      const y = toDate(ref).getUTCFullYear();
      return {
        ok: true,
        name,
        current: { period: "range", ref: null, start: `${y}-01-01`, end: `${y}-12-31` },
        previous: { period: "range", ref: null, start: `${y - 1}-01-01`, end: `${y - 1}-12-31` },
      };
    }
    case "range": {
      if (!validDate(args.start) || !validDate(args.end)) {
        return {
          ok: false,
          message: "period 'range' needs start and end as YYYY-MM-DD (end inclusive).",
        };
      }
      const span = daysBetween(args.start, args.end);
      if (span < 0) return { ok: false, message: "end is before start." };
      if (span + 1 > MAX_RANGE_DAYS) {
        return { ok: false, message: `range is limited to ${MAX_RANGE_DAYS} days.` };
      }
      return {
        ok: true,
        name,
        current: { period: "range", ref: null, start: args.start, end: args.end },
        previous: {
          period: "range",
          ref: null,
          start: addDays(args.start, -(span + 1)),
          end: addDays(args.start, -1),
        },
      };
    }
    default:
      return {
        ok: false,
        message: "period must be one of today, week, month, quarter, year, range.",
      };
  }
}

// --- filters & measure refs (pure) ----------------------------------------------------

export function parseFilters(
  v: unknown,
): { ok: true; filters: Record<string, string> } | { ok: false; message: string } {
  if (v === undefined || v === null) return { ok: true, filters: {} };
  if (typeof v !== "object" || Array.isArray(v)) {
    return { ok: false, message: "filters must be an object." };
  }
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!(ALLOWED_FILTERS as readonly string[]).includes(k)) {
      return {
        ok: false,
        message: `unknown filter "${k}". Allowed: ${ALLOWED_FILTERS.join(", ")}.`,
      };
    }
    if (raw === undefined || raw === null || raw === "") continue;
    if (UUID_FILTERS.has(k)) {
      const id = optionalUuid(raw);
      if (!id || id === "invalid") return { ok: false, message: `filter ${k} must be a UUID.` };
      out[k] = id;
    } else {
      if (typeof raw !== "string" || raw.length > 120) {
        return { ok: false, message: `filter ${k} must be text.` };
      }
      out[k] = raw;
    }
  }
  return { ok: true, filters: out };
}

export type ResolvedMetric =
  | {
    kind: "leaf";
    id: string;
    label: string;
    unit: string;
    ref: { id: string };
    recortes: string[];
    definition: string | null;
  }
  | {
    kind: "ratio";
    id: string;
    label: string;
    unit: string;
    ref: { kind: "ratio"; num: string; den: string };
    recortes: string[];
    definition: string;
  }
  | {
    kind: "cac";
    id: "cac";
    label: string;
    unit: "currency";
    recortes: string[];
    definition: string;
  };

export function resolveMetric(id: string, catalog: Catalog): ResolvedMetric | null {
  if (id === CAC.id) {
    return {
      kind: "cac",
      id: "cac",
      label: CAC.label,
      unit: "currency",
      recortes: ["total"],
      definition: CAC.definition,
    };
  }
  const m = catalog.measures.find((x) => x.id === id);
  if (m) {
    return {
      kind: "leaf",
      id: m.id,
      label: m.label,
      unit: m.unit,
      ref: { id: m.id },
      recortes: m.compatible_recortes ?? [],
      definition: m.description ?? null,
    };
  }
  const r = catalog.ratios.find((x) => x.id === id);
  if (r) {
    return {
      kind: "ratio",
      id: r.id,
      label: r.label,
      unit: r.unit,
      ref: { kind: "ratio", num: r.num, den: r.den },
      recortes: ["total"],
      definition: `${r.num} ÷ ${r.den}${r.unit === "percent" ? " × 100" : ""}`,
    };
  }
  return null;
}

// --- formatting (pure) ----------------------------------------------------------------

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, "0")} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export function formatValue(unit: string, v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  switch (unit) {
    case "currency":
      return BRL.format(v);
    case "duration_seconds":
      return formatDuration(v);
    case "percent":
      return `${NUM.format(v)}%`;
    default:
      return NUM.format(v);
  }
}

export function changePct(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null || prev === 0) return null;
  return Math.round(((curr - prev) / Math.abs(prev)) * 1000) / 10;
}

// --- CAC (pure part) ------------------------------------------------------------------

export interface InvestmentRow {
  origin: string;
  month: number;
  year: number;
  investimento_cents: number;
}

/** Monthly investment prorated by the days of [start, end] that fall in each month (BRL). */
export function proratedInvestment(rows: InvestmentRow[], start: string, end: string): number {
  let total = 0;
  for (const r of rows) {
    const mStart = fmt(new Date(Date.UTC(r.year, r.month - 1, 1)));
    const mEnd = fmt(new Date(Date.UTC(r.year, r.month, 0)));
    const from = mStart > start ? mStart : start;
    const to = mEnd < end ? mEnd : end;
    if (from > to) continue;
    const covered = daysBetween(from, to) + 1;
    const inMonth = daysBetween(mStart, mEnd) + 1;
    total += (Number(r.investimento_cents) / 100) * (covered / inMonth);
  }
  return Math.round(total * 100) / 100;
}

/** Year-month pairs touched by [start, end] — the rows CAC needs. */
export function monthsTouched(start: string, end: string): Array<{ year: number; month: number }> {
  const out: Array<{ year: number; month: number }> = [];
  const s = toDate(start);
  const e = toDate(end);
  let y = s.getUTCFullYear();
  let m = s.getUTCMonth();
  while (y < e.getUTCFullYear() || (y === e.getUTCFullYear() && m <= e.getUTCMonth())) {
    out.push({ year: y, month: m + 1 });
    m++;
    if (m === 12) {
      m = 0;
      y++;
    }
  }
  return out;
}

// --- engine calls ---------------------------------------------------------------------

interface EngineResult {
  value?: number | null;
  unit?: string;
  series?: unknown;
  empty_reason?: string | null;
  [k: string]: unknown;
}

async function measure(
  ctx: ToolContext,
  orgId: string,
  ref: unknown,
  recorte: string,
  p: EnginePeriod,
  filters: Record<string, string>,
): Promise<{ ok: true; data: EngineResult } | { ok: false; message: string }> {
  const { data, error } = await callRpc<EngineResult>(ctx, "fn_metric_measure", {
    p_org_id: orgId,
    p_measure_ref: ref,
    p_recorte: recorte,
    p_period: p.period,
    p_ref: p.ref,
    p_start: p.start,
    p_end: p.end,
    p_filters: filters,
  });
  if (error || !data) {
    return { ok: false, message: error?.message ?? "sem resposta do motor de métricas" };
  }
  return { ok: true, data };
}

const SERIES_KEYS = ["key", "id", "label", "name", "bucket", "value", "count"] as const;
const MAX_SERIES = 100;

function shapeSeries(unit: string, series: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(series)) return null;
  return series.slice(0, MAX_SERIES).map((item) => {
    const row: Record<string, unknown> = {};
    if (item && typeof item === "object") {
      for (const k of SERIES_KEYS) if (k in item) row[k] = (item as Record<string, unknown>)[k];
    }
    if (typeof row.value === "number") row.display = formatValue(unit, row.value);
    return row;
  });
}

async function cacFor(
  ctx: ToolContext,
  orgId: string,
  p: EnginePeriod,
  filters: Record<string, string>,
): Promise<
  | {
    value: number | null;
    empty_reason: string | null;
    investimento: number;
    vendas: number | null;
  }
  | { error: string }
> {
  const { start, end } = periodDates(p);
  const months = monthsTouched(start, end);
  const db = ctx.db as SupabaseClient;
  let q = db
    .from("mkt_origin_config")
    .select("origin,month,year,investimento_cents")
    .eq("organization_id", orgId) // defense-in-depth on top of RLS
    .in("year", [...new Set(months.map((m) => m.year))]);
  if (filters.origin) q = q.eq("origin", filters.origin);
  const { data, error } = await q.limit(1000);
  if (error) return { error: error.message };
  const wanted = new Set(months.map((m) => `${m.year}-${m.month}`));
  const rows = ((data ?? []) as InvestmentRow[]).filter((r) => wanted.has(`${r.year}-${r.month}`));
  const investimento = proratedInvestment(rows, start, end);

  const sales = await measure(ctx, orgId, { id: "num_vendas" }, "total", p, filters);
  if (!sales.ok) return { error: sales.message };
  const vendas = typeof sales.data.value === "number" ? sales.data.value : null;

  if (investimento <= 0) {
    return { value: null, empty_reason: "sem_investimento_cadastrado", investimento, vendas };
  }
  if (!vendas) return { value: null, empty_reason: "sem_vendas_no_periodo", investimento, vendas };
  return {
    value: Math.round((investimento / vendas) * 100) / 100,
    empty_reason: null,
    investimento,
    vendas,
  };
}

// --- tools ----------------------------------------------------------------------------

async function denyWithoutMetrics(ctx: ToolContext): Promise<ToolResult | null> {
  return (await callerHasFeature(ctx, "metrics.view"))
    ? null
    : errorResult("Seu usuário não tem acesso a Métricas no Torque (permissão metrics.view).");
}

export const customerMetricsCatalogTool: ToolDef = {
  name: "metrics.catalog",
  description:
    "List the metrics you can query with metrics.query: each metric's id, unit, definition and " +
    "the cuts (recortes) it supports, plus ratios (e.g. conversion, average ticket) and CAC. " +
    "Same catalog as the Métricas screen in Torque. Call this before metrics.query.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "Metrics catalog" },
  inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const denied = await denyWithoutMetrics(ctx);
    if (denied) return denied;

    const catalog = await loadCatalog(ctx);
    if ("error" in catalog) {
      return errorResult(`Catálogo de métricas indisponível: ${catalog.error}`);
    }
    return jsonResult({
      metrics: catalog.measures.map((m) => ({
        id: m.id,
        label: m.label,
        unit: m.unit,
        definition: m.description ?? null,
        cuts: m.compatible_recortes,
      })),
      ratios: catalog.ratios.map((r) => ({
        id: r.id,
        label: r.label,
        unit: r.unit,
        formula: `${r.num} / ${r.den}`,
        cuts: ["total"],
      })),
      derived: [{
        id: CAC.id,
        label: CAC.label,
        unit: CAC.unit,
        definition: CAC.definition,
        cuts: ["total"],
      }],
      cuts: catalog.recortes,
      periods: ["today", "week", "month", "quarter", "year", "range"],
      filters: ALLOWED_FILTERS,
    });
  },
};

export const customerMetricsQueryTool: ToolDef = {
  name: "metrics.query",
  description:
    "Compute up to 8 metrics for a period, with the same engine as Torque's Métricas screen. " +
    "Use ids from metrics.catalog (e.g. receita, leads_criados, tempo_resposta_equipe, " +
    "num_vendas, conversao, ticket_medio, cac). Periods follow the organization's timezone; " +
    "'range' takes start/end (end inclusive). cut='total' (default) also returns the previous " +
    "period and the change; cut='tempo' returns a time series; other cuts break the value down " +
    "(origem, closer, pipeline…). Missing data is reported as empty_reason, never as zero.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "Query metrics" },
  inputSchema: {
    type: "object",
    properties: {
      metrics: { type: "array", items: { type: "string" }, minItems: 1, maxItems: MAX_METRICS },
      period: { type: "string", enum: ["today", "week", "month", "quarter", "year", "range"] },
      ref: { type: "string", description: "Reference date YYYY-MM-DD (default: today)" },
      start: { type: "string", description: "Range start YYYY-MM-DD" },
      end: { type: "string", description: "Range end YYYY-MM-DD (inclusive)" },
      cut: { type: "string", description: "Recorte id from metrics.catalog (default total)" },
      filters: {
        type: "object",
        description: "Optional: pipeline_id, member_id, origin, tag_id, product_id, stream",
      },
      compare_previous: { type: "boolean", description: "Default true for cut=total" },
    },
    required: ["metrics"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const orgId = scope.orgId;

    const ids = Array.isArray(args.metrics)
      ? [...new Set(args.metrics.filter((x) => typeof x === "string"))]
      : [];
    if (ids.length === 0) {
      return errorResult("metrics must list at least one metric id (see metrics.catalog).");
    }
    if (ids.length > MAX_METRICS) return errorResult(`At most ${MAX_METRICS} metrics per call.`);
    const cut = typeof args.cut === "string" && args.cut ? args.cut : "total";
    const f = parseFilters(args.filters);
    if (!f.ok) return errorResult(f.message);

    const denied = await denyWithoutMetrics(ctx);
    if (denied) return denied;

    const db = ctx.db as SupabaseClient;
    const { data: org, error: orgErr } = await db
      .from("organizations")
      .select("timezone")
      .eq("id", orgId)
      .maybeSingle();
    if (orgErr) return dbErrorResult(orgErr);
    const tz = (org as { timezone?: string } | null)?.timezone || "America/Sao_Paulo";
    const per = resolvePeriod(args, todayIn(tz, new Date()));
    if (!per.ok) return errorResult(per.message);

    const catalog = await loadCatalog(ctx);
    if ("error" in catalog) {
      return errorResult(`Catálogo de métricas indisponível: ${catalog.error}`);
    }

    const resolved: ResolvedMetric[] = [];
    for (const id of ids) {
      const r = resolveMetric(id as string, catalog);
      if (!r) return errorResult(`Unknown metric "${id}". Use metrics.catalog to list the ids.`);
      if (!r.recortes.includes(cut)) {
        return errorResult(
          `Metric "${id}" does not support cut "${cut}". Supported: ${r.recortes.join(", ")}.`,
        );
      }
      resolved.push(r);
    }
    const compare = cut === "total" && args.compare_previous !== false;

    const results = await Promise.all(resolved.map(async (m) => {
      const base = { id: m.id, label: m.label, unit: m.unit, cut, definition: m.definition };
      if (m.kind === "cac") {
        const now = await cacFor(ctx, orgId, per.current, f.filters);
        if ("error" in now) return { ...base, error: now.error };
        const prev = compare ? await cacFor(ctx, orgId, per.previous, f.filters) : null;
        const prevValue = prev && !("error" in prev) ? prev.value : null;
        return {
          ...base,
          value: now.value,
          display: formatValue("currency", now.value),
          inputs: { investimento: formatValue("currency", now.investimento), vendas: now.vendas },
          ...(now.empty_reason ? { empty_reason: now.empty_reason } : {}),
          ...(compare
            ? {
              previous: { value: prevValue, display: formatValue("currency", prevValue) },
              change_pct: changePct(now.value, prevValue),
            }
            : {}),
        };
      }

      const now = await measure(ctx, orgId, m.ref, cut, per.current, f.filters);
      if (!now.ok) return { ...base, error: now.message };
      const unit = typeof now.data.unit === "string" ? now.data.unit : m.unit;
      const value = typeof now.data.value === "number" ? now.data.value : null;
      const out: Record<string, unknown> = { ...base, unit };
      if (cut === "total") {
        out.value = value;
        out.display = formatValue(unit, value);
      } else {
        out.series = shapeSeries(unit, now.data.series);
      }
      if (now.data.empty_reason) out.empty_reason = now.data.empty_reason;
      for (const k of Object.keys(now.data)) {
        if (k.startsWith("coverage")) out[k] = now.data[k];
      }
      if (compare) {
        const prev = await measure(ctx, orgId, m.ref, "total", per.previous, f.filters);
        const pv = prev.ok && typeof prev.data.value === "number" ? prev.data.value : null;
        out.previous = { value: pv, display: formatValue(unit, pv) };
        out.change_pct = changePct(value, pv);
      }
      return out;
    }));

    const curr = periodDates(per.current);
    const prev = periodDates(per.previous);
    return jsonResult({
      period: { name: per.name, start: curr.start, end: curr.end, timezone: tz },
      ...(compare ? { previous_period: prev } : {}),
      filters: f.filters,
      metrics: results,
    });
  },
};
