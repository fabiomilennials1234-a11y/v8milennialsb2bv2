/**
 * Fatia 6 — robustness and ergonomics across the existing tools: fail-closed guards, no silent
 * cuts, results that stay parseable, fewer round-trips. A configurable fake stands in for
 * PostgREST: per-table rows/error/count, per-RPC answers, and a record of every call.
 */
import { assertEquals, assertMatch } from "@std/assert";
import { textOf } from "../../_shared/mcp/content.ts";
import type { ToolContext } from "../../_shared/mcp/types.ts";
import {
  clock,
  customerAudiencePreviewTool,
  customerBroadcastConfirmTool,
  customerBroadcastPlanTool,
  customerBroadcastStatusTool,
} from "./broadcast.ts";
import {
  countsByStage,
  customerDealMovePlanTool,
  customerFunnelOverviewTool,
  customerFunnelReviewTool,
  shapeOverview,
  type StageRow,
} from "./funnel.ts";
import { _resetCatalogCache, customerMetricsQueryTool } from "./metrics.ts";
import {
  createLimiter,
  fitToBudget,
  isFromUs,
  jsonResult,
  mapLimit,
  MAX_RESULT_CHARS,
} from "./shared.ts";

const ORG = "33333333-3333-4333-8333-333333333333";
const PIPE = "44444444-4444-4444-8444-444444444444";
const E1 = "55555555-5555-4555-8555-555555555551";
const TOKEN = "77777777-7777-4777-8777-777777777777";

type Answer = { data?: unknown; error?: { message: string; code?: string } | null; count?: number };
type Call = { table: string; chain: Array<[string, unknown[]]> };

function fakeDb(
  tables: Record<string, Answer | ((call: Call) => Answer)>,
  rpcs: Record<string, (args: Record<string, unknown>) => Answer> = {},
) {
  const calls: Call[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const answer = (call: Call): Answer => {
    const a = tables[call.table];
    return (typeof a === "function" ? a(call) : a) ?? { data: [] };
  };
  const db = {
    from(table: string) {
      const call: Call = { table, chain: [] };
      calls.push(call);
      const resolve = (single: boolean) => {
        const a = answer(call);
        const data = single && Array.isArray(a.data) ? a.data[0] ?? null : a.data ?? null;
        return Promise.resolve({ data, error: a.error ?? null, count: a.count ?? null });
      };
      const p: unknown = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === "then") {
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              resolve(false).then(res, rej);
          }
          if (prop === "maybeSingle" || prop === "single") return () => resolve(true);
          return (...args: unknown[]) => {
            call.chain.push([prop, args]);
            return p;
          };
        },
      });
      return p;
    },
    rpc(name: string, args: Record<string, unknown> = {}) {
      rpcCalls.push({ name, args });
      const a = rpcs[name]?.(args) ?? { data: null };
      return Promise.resolve({ data: a.data ?? null, error: a.error ?? null });
    },
  };
  return { db, calls, rpcCalls };
}

const has = (c: Call, method: string, ...args: unknown[]) =>
  c.chain.some(([m, a]) => m === method && args.every((x, i) => a[i] === x));

function store() {
  const log: string[] = [];
  return {
    log,
    open: (tool: string) => {
      log.push(`open:${tool}`);
      return Promise.resolve({ actionId: TOKEN, expiresAt: "2099-01-01T00:00:00Z" });
    },
    take: () => {
      log.push("take");
      return Promise.resolve({
        tool: "broadcast.send",
        plan: { lead_ids: ["l1"], message: "Oi", instance_ids: ["i1"] },
      });
    },
    finish: () => Promise.resolve(true),
    getApplied: () => Promise.resolve(null),
    markUndone: () => Promise.resolve(true),
  };
}

const ctxOf = (db: unknown, extra: Partial<ToolContext> = {}): ToolContext => ({
  db,
  orgId: ORG,
  userId: "66666666-6666-4666-8666-666666666666",
  scopes: ["read", "crm:write", "messages:send", "automations:write"],
  ...extra,
});

// --- results that stay parseable -----------------------------------------------------------

Deno.test("jsonResult: compact JSON; over the ceiling it shrinks and stays valid JSON", () => {
  assertEquals(textOf(jsonResult({ a: [1, 2] })), '{"a":[1,2]}');
  const big = {
    count: 5000,
    cards: Array.from({ length: 5000 }, (_, i) => ({ i, t: "x".repeat(60) })),
  };
  const text = textOf(jsonResult(big));
  assertEquals(text.length <= MAX_RESULT_CHARS, true);
  const parsed = JSON.parse(text); // never cut mid-structure
  assertEquals(parsed.count, 5000);
  assertEquals(parsed._truncated.cut.cards, 5000);
  assertEquals(parsed.cards.length < 5000 && parsed.cards.length > 100, true);
});

Deno.test("fitToBudget: arrays are halved before any string is clipped; a lone string is clipped", () => {
  const out = fitToBudget({
    note: "n".repeat(50),
    rows: Array.from({ length: 64 }, () => "r".repeat(50)),
  }, 900);
  assertEquals(out.note, "n".repeat(50)); // the string survived: the array paid
  assertEquals(JSON.stringify(out).length <= 900, true);
  const s = fitToBudget("y".repeat(5000), 600) as { result: string };
  assertEquals(s.result.endsWith("…"), true);
  assertEquals(JSON.stringify(s).length <= 600, true);
});

Deno.test("isFromUs: both spellings the data has", () => {
  assertEquals([isFromUs("outgoing"), isFromUs("outbound"), isFromUs("incoming"), isFromUs(null)], [
    true,
    true,
    false,
    false,
  ]);
});

Deno.test("mapLimit / createLimiter: never more than N in flight; results in input order", async () => {
  let inFlight = 0;
  let peak = 0;
  const slow = async (x: number) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight--;
    return x * 2;
  };
  assertEquals(await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, slow), [2, 4, 6, 8, 10, 12, 14]);
  assertEquals(peak, 3);
  peak = 0;
  const run = createLimiter(2);
  const out = await Promise.all([1, 2, 3, 4, 5].map((x) => run(() => slow(x))));
  assertEquals([out, peak], [[2, 4, 6, 8, 10], 2]);
  // a synchronous throw releases its slot
  const boom = await run(() => {
    throw new Error("x");
  }).catch((e) => (e as Error).message);
  assertEquals([boom, await run(() => Promise.resolve(7))], ["x", 7]);
});

// --- broadcast: fail closed, never a silent cut --------------------------------------------

const AUDIENCE = { pipeline_id: PIPE };
const entries = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    lead_id: `l${i}`,
    leads: {
      id: `l${i}`,
      name: `Lead ${i}`,
      company: null,
      segment: null,
      normalized_phone: "5511999990000",
      deleted_at: null,
    },
  }));
const INSTANCE = {
  id: "88888888-8888-4888-8888-888888888888",
  instance_name: "n",
  phone_number: null,
  status: "connected",
  provider: "uazapi",
  reserved_for: null,
};

Deno.test("broadcast.plan: unreadable memberships refuse the broadcast (multi-org guard fails closed)", async () => {
  const f = fakeDb({ team_members: { error: { message: "boom" } } });
  const s = store();
  const res = await customerBroadcastPlanTool.handler(
    { audience: AUDIENCE, message: "Oi" },
    ctxOf(f.db, { actions: s }),
  );
  assertEquals(res.isError, true);
  assertEquals(s.log, []);
});

Deno.test("broadcast.plan: a bigger audience than the cap is refused unless the person accepted a partial send", async () => {
  const tables = {
    team_members: { data: [{ organization_id: ORG }] },
    pipeline_entries: { data: entries(3), count: 1500 },
    whatsapp_instances: { data: [INSTANCE] },
  };
  const s = store();
  const refused = await customerBroadcastPlanTool.handler(
    { audience: AUDIENCE, message: "Oi" },
    ctxOf(fakeDb(tables).db, { actions: s }),
  );
  assertEquals(refused.isError, true);
  assertMatch(textOf(refused), /1500 cards/);
  assertEquals(s.log, []);
  const ok = JSON.parse(textOf(
    await customerBroadcastPlanTool.handler(
      { audience: AUDIENCE, message: "Oi", accept_partial: true },
      ctxOf(fakeDb(tables).db, { actions: s }),
    ),
  ));
  assertEquals([ok.matching_cards, ok.truncated, s.log], [1500, true, ["open:broadcast.send"]]);
});

Deno.test("audience.preview: exact count of matching cards, and says when it was cut", async () => {
  const f = fakeDb({ pipeline_entries: { data: entries(2), count: 1200 } });
  const out = JSON.parse(textOf(
    await customerAudiencePreviewTool.handler({ pipeline_id: PIPE }, ctxOf(f.db)),
  ));
  assertEquals([out.matching_cards, out.truncated], [1200, true]);
  assertMatch(out.note, /accept_partial/);
});

Deno.test("broadcast.confirm: unreadable org timezone or memberships send nothing and keep the plan", async () => {
  const real = clock.now;
  clock.now = () => new Date("2026-11-23T15:00:00Z");
  try {
    for (
      const tables of [
        { organizations: { error: { message: "tz" } } },
        {
          organizations: { data: [{ timezone: "UTC" }] },
          team_members: { error: { message: "tm" } },
        },
      ] as Array<Record<string, Answer>>
    ) {
      const s = store();
      const edge: unknown[] = [];
      const res = await customerBroadcastConfirmTool.handler(
        { confirm_token: TOKEN },
        ctxOf(fakeDb(tables).db, {
          actions: s,
          edge: (fn: string) => {
            edge.push(fn);
            return Promise.resolve({ status: 200, body: {} });
          },
        }),
      );
      assertEquals(res.isError, true);
      assertEquals([s.log, edge], [[], []]); // plan not consumed, engine not called
    }
  } finally {
    clock.now = real;
  }
});

Deno.test("broadcast.status: counts in parallel, and a failed count is an error, not a zero", async () => {
  const plan = { data: [{ id: "bp", status: "active" }] };
  const ok = fakeDb({
    blast_plans: plan,
    blast_plan_recipients: (c) => ({ data: null, count: has(c, "eq", "status", "sent") ? 7 : 1 }),
  });
  const out = JSON.parse(textOf(
    await customerBroadcastStatusTool.handler({ blast_plan_id: TOKEN }, ctxOf(ok.db)),
  ));
  assertEquals(out.recipients, { sent: 7, failed: 1, skipped: 1, pending: 1 });
  const bad = fakeDb({
    blast_plans: plan,
    blast_plan_recipients: { error: { message: "timeout" } },
  });
  const res = await customerBroadcastStatusTool.handler({ blast_plan_id: TOKEN }, ctxOf(bad.db));
  assertEquals(res.isError, true);
});

// --- funnel ---------------------------------------------------------------------------------

const stage = (key: string, extra: Partial<StageRow> = {}): StageRow => ({
  id: `id-${key}`,
  stage_key: key,
  name: key.toUpperCase(),
  position: 1,
  stage_role: null,
  requires_sale_value: false,
  is_final_positive: false,
  is_final_negative: false,
  pipeline_id: PIPE,
  ...extra,
});

const card = (id: string, phone: string) => ({
  id,
  deal_id: null,
  lead_id: `lead-${id}`,
  stage_key: "novo",
  entered_at: null,
  stage_changed_at: "2026-11-01T00:00:00Z",
  created_at: "2026-11-01T00:00:00Z",
  leads: { id: `lead-${id}`, name: id, company: null, phone, normalized_phone: phone },
});

Deno.test("funnel.review: one message query PER phone, so a chatty contact cannot starve the others", async () => {
  const f = fakeDb({
    pipeline_stages: { data: [stage("novo")] },
    pipeline_entries: { data: [card("a", "551100000001"), card("b", "551100000002")] },
    whatsapp_messages: (c) => {
      const phone = c.chain.find(([m, a]) => m === "eq" && a[0] === "normalized_phone")?.[1][1];
      return {
        data: [{
          normalized_phone: phone,
          timestamp: "2026-11-20T10:00:00Z",
          direction: phone === "551100000001" ? "outbound" : "incoming",
          message_type: "text",
          content: `oi ${phone}`,
          transcription_text: null,
        }],
      };
    },
  });
  const out = JSON.parse(textOf(
    await customerFunnelReviewTool.handler(
      { pipeline_id: PIPE, messages_per_card: 3 },
      ctxOf(f.db),
    ),
  ));
  const msgCalls = f.calls.filter((c) => c.table === "whatsapp_messages");
  assertEquals(msgCalls.length, 2);
  for (const c of msgCalls) {
    assertEquals(has(c, "eq", "organization_id", ORG), true);
    assertEquals(has(c, "limit", 3), true);
  }
  // "outbound" is ours too: the first contact is not waiting for a reply
  assertEquals(out.cards.map((c: { awaiting_reply: boolean }) => c.awaiting_reply), [false, true]);
});

Deno.test("funnel.review: messages_per_card 0 skips the messages; idle_days_min narrows the cards", async () => {
  const f = fakeDb({
    pipeline_stages: { data: [stage("novo")] },
    pipeline_entries: { data: [card("a", "551100000001")] },
  });
  await customerFunnelReviewTool.handler(
    { pipeline_id: PIPE, messages_per_card: 0, idle_days_min: 5 },
    ctxOf(f.db),
  );
  assertEquals(f.calls.some((c) => c.table === "whatsapp_messages"), false);
  const entriesCall = f.calls.find((c) => c.table === "pipeline_entries")!;
  assertEquals(
    entriesCall.chain.some(([m, a]) =>
      m === "or" && String(a[0]).startsWith("stage_changed_at.lt.")
    ),
    true,
  );
  const bad = await customerFunnelReviewTool.handler(
    { pipeline_id: PIPE, messages_per_card: 99 },
    ctxOf(fakeDb({}).db),
  );
  assertEquals(bad.isError, true);
});

Deno.test("shapeOverview: counts per stage, stalled only for open stages, totals by kind", () => {
  const out = shapeOverview(
    { id: PIPE, name: "Vendas" },
    [
      stage("novo"),
      stage("proposta"),
      stage("ganho", { stage_role: "won" }),
      stage("perdido", { is_final_negative: true }),
    ],
    countsByStage([{ stage_key: "novo", cnt: "10" }, { stage_key: "proposta", cnt: 4 }, {
      stage_key: "ganho",
      cnt: 3,
    }, { stage_key: "perdido", cnt: 2 }]),
    countsByStage([{ stage_key: "novo", cnt: 6 }, { stage_key: "ganho", cnt: 3 }]),
  );
  assertEquals([out.open_cards, out.stalled_open_cards, out.won_cards, out.lost_cards], [
    14,
    6,
    3,
    2,
  ]);
  assertEquals(out.stages[0], { key: "novo", name: "NOVO", kind: "open", cards: 10, stalled: 6 });
  assertEquals("stalled" in out.stages[2], false);
});

Deno.test("funnel.overview: every active funnel in one call, counted by the board's own RPC in the token org", async () => {
  const P2 = "44444444-4444-4444-8444-444444444445";
  const f = fakeDb(
    {
      pipelines: { data: [{ id: PIPE, name: "Vendas" }, { id: P2, name: "Pós" }] },
      pipeline_stages: { data: [stage("novo"), stage("novo", { pipeline_id: P2, id: "x" })] },
    },
    {
      get_pipeline_stage_counts_by_id: (a) => ({
        data: [{
          stage_key: "novo",
          cnt: a.p_stalled_min_days ? 2 : a.p_pipeline_id === PIPE ? 9 : 1,
        }],
      }),
    },
  );
  const out = JSON.parse(textOf(
    await customerFunnelOverviewTool.handler({ stalled_days: 10 }, ctxOf(f.db)),
  ));
  assertEquals(
    out.pipelines.map((p: { name: string; open_cards: number }) => [p.name, p.open_cards]),
    [["Vendas", 9], ["Pós", 1]],
  );
  assertEquals(out.pipelines[0].stalled_open_cards, 2);
  assertEquals(f.rpcCalls.length, 4);
  for (const r of f.rpcCalls) assertEquals(r.args.p_org_id, ORG);
  assertEquals(f.rpcCalls.filter((r) => r.args.p_stalled_min_days === 10).length, 2);
});

Deno.test("funnel.overview: a count failure is an error, never a zero", async () => {
  const f = fakeDb(
    {
      pipelines: { data: [{ id: PIPE, name: "Vendas" }] },
      pipeline_stages: { data: [stage("novo")] },
    },
    { get_pipeline_stage_counts_by_id: () => ({ error: { message: "timeout" } }) },
  );
  const res = await customerFunnelOverviewTool.handler({}, ctxOf(f.db));
  assertEquals(res.isError, true);
});

Deno.test("deal.move.plan: a failed automations lookup fails the plan instead of promising 'no side effects'", async () => {
  const f = fakeDb(
    {
      pipeline_entries: {
        data: [{
          id: E1,
          pipeline_id: PIPE,
          stage_key: "novo",
          lead_id: "l1",
          closed_at: null,
          sale_value: null,
          leads: { name: "Ana" },
        }],
      },
      pipeline_stages: { data: [stage("novo"), stage("proposta")] },
      workflows: { error: { message: "statement timeout" } },
    },
    { has_feature_permission: () => ({ data: true }) },
  );
  const s = store();
  const res = await customerDealMovePlanTool.handler(
    { moves: [{ entry_id: E1, to_stage_key: "proposta", reason: "pediu proposta" }] },
    ctxOf(f.db, { actions: s }),
  );
  assertEquals(res.isError, true);
  assertMatch(textOf(res), /statement timeout/);
  assertEquals(s.log, []);
});

// --- metrics --------------------------------------------------------------------------------

function metricsDb(opts: { failPrevious?: boolean } = {}) {
  return fakeDb(
    {
      organizations: { data: [{ timezone: "America/Sao_Paulo" }] },
      mkt_origin_config: { data: [] },
    },
    {
      has_feature_permission: () => ({ data: true }),
      fn_metric_catalog: () => ({
        data: {
          measures: [
            { id: "receita", label: "Receita", unit: "currency", compatible_recortes: ["total"] },
            { id: "num_vendas", label: "Vendas", unit: "count", compatible_recortes: ["total"] },
          ],
          ratios: [{
            id: "ticket_medio",
            label: "Ticket",
            num: "receita",
            den: "num_vendas",
            unit: "currency",
          }],
          recortes: [],
        },
      }),
      fn_metric_measure: (a) =>
        opts.failPrevious && String(a.p_ref).startsWith("2026-10")
          ? { error: { message: "canceling statement due to statement timeout" } }
          : { data: { unit: "count", value: 4 } },
    },
  );
}

Deno.test("metrics.query: a measure shared by several metrics runs once per period", async () => {
  _resetCatalogCache();
  const f = metricsDb();
  await customerMetricsQueryTool.handler(
    { metrics: ["num_vendas", "cac"], period: "month", ref: "2026-11-10" },
    ctxOf(f.db),
  );
  const vendas = f.rpcCalls.filter((r) =>
    r.name === "fn_metric_measure" && (r.args.p_measure_ref as { id?: string })?.id === "num_vendas"
  );
  assertEquals(vendas.length, 2); // current + previous, shared by num_vendas and CAC
});

Deno.test("metrics.query: a failed comparison is reported as an error, not as 'no data'", async () => {
  _resetCatalogCache();
  const f = metricsDb({ failPrevious: true });
  const out = JSON.parse(textOf(
    await customerMetricsQueryTool.handler(
      { metrics: ["num_vendas"], period: "month", ref: "2026-11-10" },
      ctxOf(f.db),
    ),
  ));
  assertEquals(out.metrics[0].value, 4);
  assertEquals(out.metrics[0].previous.value, null);
  assertMatch(out.metrics[0].previous.error, /statement timeout/);
});
