import { assertEquals } from "@std/assert";
import { textOf } from "../../_shared/mcp/content.ts";
import type { ToolContext } from "../../_shared/mcp/types.ts";
import {
  _resetCatalogCache,
  changePct,
  customerMetricsQueryTool,
  formatDuration,
  formatValue,
  monthsTouched,
  parseFilters,
  periodDates,
  proratedInvestment,
  resolveMetric,
  resolvePeriod,
  todayIn,
} from "./metrics.ts";

const ORG = "33333333-3333-4333-8333-333333333333";

Deno.test("resolvePeriod: month → engine month + previous month (across a year boundary)", () => {
  const p = resolvePeriod({ period: "month", ref: "2026-01-15" }, "2026-11-23");
  if (!p.ok) throw new Error(p.message);
  assertEquals(periodDates(p.current), { start: "2026-01-01", end: "2026-01-31" });
  assertEquals(periodDates(p.previous), { start: "2025-12-01", end: "2025-12-31" });
});

Deno.test("resolvePeriod: week starts Monday (as metric_period_bounds) and previous is the week before", () => {
  const p = resolvePeriod({ period: "week", ref: "2026-11-23" }, "x"); // a Monday
  if (!p.ok) throw new Error(p.message);
  assertEquals(periodDates(p.current), { start: "2026-11-23", end: "2026-11-29" });
  assertEquals(periodDates(p.previous), { start: "2026-11-16", end: "2026-11-22" });
});

Deno.test("resolvePeriod: today/quarter/year/range and the default (month of org-local today)", () => {
  const t = resolvePeriod({ period: "today" }, "2026-11-23");
  if (!t.ok) throw new Error(t.message);
  assertEquals([t.current.period, t.current.ref, t.previous.ref], [
    "day",
    "2026-11-23",
    "2026-11-22",
  ]);

  const q = resolvePeriod({ period: "quarter", ref: "2026-11-23" }, "x");
  if (!q.ok) throw new Error(q.message);
  assertEquals([q.current.start, q.current.end, q.previous.start, q.previous.end], [
    "2026-10-01",
    "2026-12-31",
    "2026-07-01",
    "2026-09-30",
  ]);

  const y = resolvePeriod({ period: "year", ref: "2026-03-01" }, "x");
  if (!y.ok) throw new Error(y.message);
  assertEquals([y.current.start, y.previous.end], ["2026-01-01", "2025-12-31"]);

  const r = resolvePeriod({ period: "range", start: "2026-11-01", end: "2026-11-10" }, "x");
  if (!r.ok) throw new Error(r.message);
  assertEquals([r.previous.start, r.previous.end], ["2026-10-22", "2026-10-31"]); // same 10 days before

  const d = resolvePeriod({}, "2026-11-23");
  if (!d.ok) throw new Error(d.message);
  assertEquals([d.name, d.current.ref], ["month", "2026-11-23"]);
});

Deno.test("resolvePeriod: refuses bad dates, inverted and oversized ranges, unknown periods", () => {
  assertEquals(resolvePeriod({ period: "month", ref: "23/11/2026" }, "x").ok, false);
  assertEquals(resolvePeriod({ period: "month", ref: "2026-02-30" }, "x").ok, false);
  assertEquals(
    resolvePeriod({ period: "range", start: "2026-11-10", end: "2026-11-01" }, "x").ok,
    false,
  );
  assertEquals(
    resolvePeriod({ period: "range", start: "2020-01-01", end: "2026-01-01" }, "x").ok,
    false,
  );
  assertEquals(resolvePeriod({ period: "range", start: "2026-11-01" }, "x").ok, false);
  assertEquals(resolvePeriod({ period: "decade" }, "x").ok, false);
});

Deno.test("todayIn: the org's local date, not UTC", () => {
  const lateNightUtc = new Date("2026-11-24T01:30:00Z"); // still the 23rd in São Paulo
  assertEquals(todayIn("America/Sao_Paulo", lateNightUtc), "2026-11-23");
  assertEquals(todayIn("UTC", lateNightUtc), "2026-11-24");
});

Deno.test("parseFilters: allowlisted keys only, UUIDs validated, blanks dropped", () => {
  assertEquals(parseFilters(undefined), { ok: true, filters: {} });
  assertEquals(parseFilters({ origin: "meta", pipeline_id: "" }), {
    ok: true,
    filters: { origin: "meta" },
  });
  assertEquals(parseFilters({ organization_id: ORG }).ok, false); // no org override via filters
  assertEquals(parseFilters({ member_id: "not-a-uuid" }).ok, false);
  assertEquals(parseFilters(["x"]).ok, false);
});

Deno.test("resolveMetric: leaf, ratio and the derived CAC", () => {
  const cat = {
    measures: [{
      id: "receita",
      label: "Receita",
      unit: "currency",
      compatible_recortes: ["total", "tempo"],
    }],
    ratios: [{
      id: "ticket_medio",
      label: "Ticket",
      num: "receita",
      den: "num_vendas",
      unit: "currency",
    }],
    recortes: [],
  };
  assertEquals(resolveMetric("receita", cat)?.kind, "leaf");
  const r = resolveMetric("ticket_medio", cat);
  assertEquals(r?.kind === "ratio" && r.ref, { kind: "ratio", num: "receita", den: "num_vendas" });
  assertEquals(resolveMetric("cac", cat)?.kind, "cac");
  assertEquals(resolveMetric("nope", cat), null);
});

Deno.test("CAC: monthly investment prorated by the days of the period", () => {
  const rows = [
    { origin: "meta", month: 11, year: 2026, investimento_cents: 300000 }, // R$ 3.000 in Nov (30 days)
    { origin: "google", month: 12, year: 2026, investimento_cents: 310000 }, // R$ 3.100 in Dec (31 days)
  ];
  assertEquals(proratedInvestment(rows, "2026-11-01", "2026-11-30"), 3000);
  assertEquals(proratedInvestment(rows, "2026-11-16", "2026-11-30"), 1500); // half of November
  assertEquals(proratedInvestment(rows, "2026-11-30", "2026-12-01"), 200); // 1 day each
  assertEquals(monthsTouched("2026-11-20", "2027-01-05").map((m) => `${m.year}-${m.month}`), [
    "2026-11",
    "2026-12",
    "2027-1",
  ]);
});

Deno.test("formatting: BRL, durations, percent; change vs previous", () => {
  assertEquals(formatValue("currency", 1234.5)?.replace(/\s/g, " "), "R$ 1.234,50");
  assertEquals(formatDuration(45), "45 s");
  assertEquals(formatDuration(200), "3 min 20 s");
  assertEquals(formatDuration(3900), "1 h 05 min");
  assertEquals(formatValue("percent", 12.5), "12,5%");
  assertEquals(formatValue("count", null), null);
  assertEquals(changePct(120, 100), 20);
  assertEquals(changePct(80, 100), -20);
  assertEquals(changePct(5, 0), null);
});

// --- handler behaviour over a fake client ------------------------------------------------

function fakeCtx(opts: { canView?: boolean; invest?: unknown[]; sales?: number } = {}) {
  const rpc: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = {
    rpc(name: string, args: Record<string, unknown>) {
      rpc.push({ name, args });
      if (name === "has_feature_permission") {
        return Promise.resolve({ data: opts.canView ?? true, error: null });
      }
      if (name === "fn_metric_catalog") {
        return Promise.resolve({
          data: {
            measures: [
              { id: "receita", label: "Receita", unit: "currency", compatible_recortes: ["total"] },
              { id: "num_vendas", label: "Vendas", unit: "count", compatible_recortes: ["total"] },
            ],
            ratios: [],
            recortes: [],
          },
          error: null,
        });
      }
      const id = (args.p_measure_ref as { id?: string })?.id;
      return Promise.resolve({
        data: id === "num_vendas"
          ? { unit: "count", value: opts.sales ?? 4 }
          : { unit: "currency", value: 1000 },
        error: null,
      });
    },
    from(table: string) {
      const result = table === "organizations"
        ? { data: { timezone: "America/Sao_Paulo" }, error: null }
        : { data: opts.invest ?? [], error: null };
      const b: Record<string, unknown> = {};
      const p: unknown = new Proxy(b, {
        get(_t, prop: string) {
          if (prop === "then") {
            return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
          }
          if (prop === "maybeSingle") return () => Promise.resolve(result);
          return () => p;
        },
      });
      return p;
    },
  };
  const ctx: ToolContext = { db, orgId: ORG, userId: "u", scopes: ["read"] };
  return { ctx, rpc };
}

Deno.test("metrics.query: without metrics.view the engine is never called", async () => {
  _resetCatalogCache();
  const { ctx, rpc } = fakeCtx({ canView: false });
  const res = await customerMetricsQueryTool.handler({ metrics: ["receita"] }, ctx);
  assertEquals(res.isError, true);
  assertEquals(rpc.some((r) => r.name === "fn_metric_measure"), false);
});

Deno.test("metrics.query: CAC = prorated investment ÷ sales; unavailable without investment", async () => {
  _resetCatalogCache();
  const withInvest = fakeCtx({
    invest: [{ origin: "meta", month: 11, year: 2026, investimento_cents: 400000 }],
    sales: 4,
  });
  const ok = JSON.parse(textOf(
    await customerMetricsQueryTool.handler(
      { metrics: ["cac"], period: "month", ref: "2026-11-10", compare_previous: false },
      withInvest.ctx,
    ),
  ));
  assertEquals(ok.metrics[0].value, 1000); // R$ 4.000 / 4 vendas

  _resetCatalogCache();
  const none = fakeCtx({ invest: [] });
  const empty = JSON.parse(textOf(
    await customerMetricsQueryTool.handler({ metrics: ["cac"], compare_previous: false }, none.ctx),
  ));
  assertEquals(empty.metrics[0].value, null);
  assertEquals(empty.metrics[0].empty_reason, "sem_investimento_cadastrado");
});

Deno.test("metrics.query: unknown metric and incompatible cut are explained, not guessed", async () => {
  _resetCatalogCache();
  const { ctx } = fakeCtx();
  const unknown = await customerMetricsQueryTool.handler({ metrics: ["faturamento_magico"] }, ctx);
  assertEquals(unknown.isError, true);
  _resetCatalogCache();
  const badCut = await customerMetricsQueryTool.handler(
    { metrics: ["receita"], cut: "etapa" },
    ctx,
  );
  assertEquals(badCut.isError, true);
});
