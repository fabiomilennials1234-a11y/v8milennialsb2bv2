import { assertEquals, assertMatch } from "@std/assert";
import { textOf } from "../../_shared/mcp/content.ts";
import type { ToolContext } from "../../_shared/mcp/types.ts";
import {
  clock,
  customerBroadcastConfirmTool,
  eligibleInstances,
  estimateDays,
  idleOrFilter,
  inSendWindow,
  parseAudience,
  renderPreview,
  shapeAudience,
} from "./broadcast.ts";

const ORG = "33333333-3333-4333-8333-333333333333";
const PIPE = "44444444-4444-4444-8444-444444444444";
const TOKEN = "77777777-7777-4777-8777-777777777777";

Deno.test("parseAudience: funnel required, stages optional, idle days 0–365", () => {
  assertEquals(parseAudience({ pipeline_id: PIPE, idle_days_min: 3 }), {
    ok: true,
    filter: { pipelineId: PIPE, stageKeys: [], idleDaysMin: 3 },
  });
  assertEquals(parseAudience({ pipeline_id: "x" }).ok, false);
  assertEquals(parseAudience({ pipeline_id: PIPE, idle_days_min: 3.5 }).ok, false);
  assertEquals(parseAudience({ pipeline_id: PIPE, idle_days_min: 400 }).ok, false);
});

Deno.test("idleOrFilter: COALESCE(stage_changed_at, entered_at, created_at) < cutoff, quoted", () => {
  const f = idleOrFilter("2026-11-20T00:00:00.000Z");
  assertMatch(f, /^stage_changed_at\.lt\."2026-11-20T00:00:00\.000Z",/);
  assertMatch(f, /and\(stage_changed_at\.is\.null,entered_at\.lt\./);
  assertMatch(f, /and\(stage_changed_at\.is\.null,entered_at\.is\.null,created_at\.lt\./);
});

Deno.test("shapeAudience: one message per lead; no phone / deleted are left out and counted", () => {
  const lead = (id: string, extra = {}) => ({
    lead_id: id,
    leads: {
      id,
      name: `L${id}`,
      company: null,
      segment: null,
      normalized_phone: "11999990000",
      deleted_at: null,
      ...extra,
    },
  });
  const r = shapeAudience([
    lead("1"),
    lead("1"),
    lead("2", { normalized_phone: null }),
    lead("3", { deleted_at: "x" }),
    lead("4"),
  ]);
  assertEquals(r.leads.map((l) => l.id), ["1", "4"]);
  assertEquals(r.excluded, { sem_telefone: 1, lead_apagado: 1, repetidos: 1 });
});

Deno.test("renderPreview: the engine's own variables and resolver", () => {
  const out = renderPreview("Oi {{primeiro_nome}}, tudo certo na {{empresa}}?", {
    id: "1",
    name: "Ana Souza",
    company: "Acme",
    segment: null,
  });
  assertEquals(out, "Oi Ana, tudo certo na Acme?");
});

Deno.test("inSendWindow: Mon–Sat 08:00–20:00 in the org's timezone", () => {
  const sp = "America/Sao_Paulo"; // UTC-3
  assertEquals(inSendWindow(new Date("2026-11-23T10:59:00Z"), sp), false); // Mon 07:59
  assertEquals(inSendWindow(new Date("2026-11-23T11:00:00Z"), sp), true); // Mon 08:00
  assertEquals(inSendWindow(new Date("2026-11-23T22:59:00Z"), sp), true); // Mon 19:59
  assertEquals(inSendWindow(new Date("2026-11-23T23:00:00Z"), sp), false); // Mon 20:00
  assertEquals(inSendWindow(new Date("2026-11-22T15:00:00Z"), sp), false); // Sunday
  assertEquals(inSendWindow(new Date("2026-11-28T15:00:00Z"), sp), true); // Saturday
});

Deno.test("eligibleInstances: connected Uazapi only; a department number never broadcasts", () => {
  const i = (id: string, extra = {}) => ({
    id,
    instance_name: id,
    phone_number: null,
    status: "connected",
    provider: "uazapi",
    reserved_for: null,
    ...extra,
  });
  const out = eligibleInstances([
    i("ok"),
    i("cobranca", { reserved_for: "collections" }),
    i("off", { status: "disconnected" }),
    i("oficial", { provider: "notificame" }),
  ]);
  assertEquals(out.map((x) => x.id), ["ok"]);
});

Deno.test("estimateDays: org cap 200/day, 80/day per number", () => {
  assertEquals(estimateDays(150, 1), 2); // 80/day with one number
  assertEquals(estimateDays(150, 3), 1); // 200/day org cap
  assertEquals(estimateDays(1000, 5), 5);
});

// --- confirm over fakes -----------------------------------------------------------------

function fakes(
  opts: {
    orgs?: number;
    plan?: unknown;
    engine?: { status: number; body: Record<string, unknown> };
    orphan?: Record<string, unknown>;
  },
) {
  const store: string[] = [];
  const edgeCalls: Array<{ fn: string; body: unknown }> = [];
  const db = {
    from(table: string) {
      const result = table === "organizations"
        ? { data: { timezone: "UTC" }, error: null }
        : table === "blast_plans"
        ? { data: opts.orphan ?? null, error: null }
        : {
          data: Array.from({ length: opts.orgs ?? 1 }, (_, i) => ({ organization_id: `o${i}` })),
          error: null,
        };
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
  const ctx: ToolContext = {
    db,
    orgId: ORG,
    userId: "u",
    scopes: ["read", "messages:send"],
    actions: {
      take: () => {
        store.push("take");
        return Promise.resolve(opts.plan ? { tool: "broadcast.send", plan: opts.plan } : null);
      },
      finish: (_id: string, status: string) => {
        store.push(`finish:${status}`);
        return Promise.resolve(true);
      },
    },
    edge: (fn: string, body: unknown) => {
      edgeCalls.push({ fn, body });
      return Promise.resolve(
        opts.engine ??
          { status: 200, body: { ok: true, plan_id: "bp-1", total_recipients: 2, lots_total: 1 } },
      );
    },
  };
  return { ctx, store, edgeCalls };
}

const PLAN = {
  lead_ids: ["l1", "l2"],
  message: "Oi {{primeiro_nome}}",
  instance_ids: ["i1"],
  exclude_blasted_within_days: 7,
};

// Pin the send-window clock (Mon 2026-11-23 12:00 UTC, inside the window by default).
async function at<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  const real = clock.now;
  clock.now = () => new Date(iso);
  try {
    return await fn();
  } finally {
    clock.now = real;
  }
}
const atNoon = <T>(fn: () => Promise<T>) => at("2026-11-23T12:00:00Z", fn);

Deno.test("confirm: hands the STORED plan to the Disparos engine and audits", () =>
  atNoon(async () => {
    const f = fakes({ plan: PLAN });
    const res = JSON.parse(
      textOf(await customerBroadcastConfirmTool.handler({ confirm_token: TOKEN }, f.ctx)),
    );
    assertEquals(res.blast_plan_id, "bp-1");
    assertEquals(f.edgeCalls.length, 1);
    assertEquals(f.edgeCalls[0].fn, "blast-plan-create");
    const body = f.edgeCalls[0].body as Record<string, unknown>;
    assertEquals([body.lead_ids, body.instance_ids, body.message], [
      PLAN.lead_ids,
      PLAN.instance_ids,
      PLAN.message,
    ]);
    assertEquals(f.store, ["take", "finish:applied"]);
  }));

Deno.test("confirm: a multi-org user is refused before the plan is consumed", () =>
  atNoon(async () => {
    const f = fakes({ plan: PLAN, orgs: 2 });
    const res = await customerBroadcastConfirmTool.handler({ confirm_token: TOKEN }, f.ctx);
    assertEquals(res.isError, true);
    assertEquals(f.store, []);
    assertEquals(f.edgeCalls.length, 0);
  }));

Deno.test("confirm: engine refusal is recorded as failed and reported", () =>
  atNoon(async () => {
    const f = fakes({ plan: PLAN, engine: { status: 403, body: { error: "No organization" } } });
    const res = await customerBroadcastConfirmTool.handler({ confirm_token: TOKEN }, f.ctx);
    assertEquals(res.isError, true);
    assertMatch(textOf(res), /No organization/);
    assertEquals(f.store, ["take", "finish:failed"]);
  }));

Deno.test("confirm: engine created the plan but lot 1 failed → reported honestly, with the id", () =>
  atNoon(async () => {
    const f = fakes({
      plan: PLAN,
      engine: { status: 500, body: { error: "UAZAPI_BASE_URL not set" } },
      orphan: { id: "bp-9", status: "active", total_recipients: 2 },
    });
    const res = JSON.parse(
      textOf(await customerBroadcastConfirmTool.handler({ confirm_token: TOKEN }, f.ctx)),
    );
    assertEquals([res.started, res.blast_plan_id], [false, "bp-9"]);
    assertEquals(f.store, ["take", "finish:partial"]);
  }));

Deno.test("confirm: outside the send window nothing is consumed or sent", () =>
  at("2026-11-22T15:00:00Z", async () => { // Sunday
    const f = fakes({ plan: PLAN });
    const res = await customerBroadcastConfirmTool.handler({ confirm_token: TOKEN }, f.ctx);
    assertEquals(res.isError, true);
    assertMatch(textOf(res), /janela de envio/);
    assertEquals([f.store.length, f.edgeCalls.length], [0, 0]);
  }));
