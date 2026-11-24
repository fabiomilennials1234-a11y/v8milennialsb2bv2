import { assertEquals, assertMatch } from "@std/assert";
import { textOf } from "../../_shared/mcp/content.ts";
import type { ToolContext } from "../../_shared/mcp/types.ts";
import { CUSTOMER_TOOLS, customerToolFilter } from "./index.ts";
import { leadListOrFilter, parseLeadListArgs } from "./lead.ts";
import { shapeThread } from "./conversation.ts";
import { instanceHealth } from "./whatsapp.ts";
import { _resetCatalogCache } from "./metrics.ts";
import { RPC_ALLOWLIST } from "./rpc.ts";
import {
  clampLimit,
  combineOrGroups,
  decodeCursor,
  encodeCursor,
  jsonResult,
  MAX_RESULT_CHARS,
  optionalIsoDate,
  pgrstQuote,
  sanitizeSearch,
} from "./shared.ts";

const ORG = "33333333-3333-4333-8333-333333333333";
const OTHER_ORG = "44444444-4444-4444-8444-444444444444";
const LEAD = "55555555-5555-4555-8555-555555555555";

// --- a recording PostgREST stand-in --------------------------------------------------

type Call = { table: string; chain: Array<[string, unknown[]]> };

/**
 * Chainable fake of the supabase-js query builder. Records every method call per `.from()`
 * and resolves to `rows` when awaited (or via maybeSingle/single). `.rpc` is recorded too,
 * so a test can assert it is never used.
 */
const FAKE_CATALOG = {
  measures: [
    {
      id: "receita",
      label: "Receita",
      unit: "currency",
      compatible_recortes: ["total", "tempo", "origem"],
    },
    {
      id: "num_vendas",
      label: "Nº de vendas",
      unit: "count",
      compatible_recortes: ["total", "origem"],
    },
    {
      id: "leads_criados",
      label: "Leads criados",
      unit: "count",
      compatible_recortes: ["total", "tempo"],
    },
  ],
  ratios: [{
    id: "ticket_medio",
    label: "Ticket médio",
    num: "receita",
    den: "num_vendas",
    unit: "currency",
  }],
  recortes: [{ id: "total", label: "Total" }],
};

function fakeRpc(name: string): unknown {
  if (name === "has_feature_permission") return true;
  if (name === "fn_metric_catalog") return FAKE_CATALOG;
  if (name === "fn_metric_measure") return { unit: "currency", value: 1000 };
  return null;
}

function fakeDb(rows: (table: string) => unknown[] = () => []) {
  const calls: Call[] = [];
  const rpcCalls: string[] = [];
  const rpcArgs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      const call: Call = { table, chain: [] };
      calls.push(call);
      const result = () => Promise.resolve({ data: rows(table), error: null });
      const builder: Record<string, unknown> = {};
      const proxy: unknown = new Proxy(builder, {
        get(_t, prop: string) {
          if (prop === "then") return (res: (v: unknown) => unknown) => result().then(res);
          if (prop === "maybeSingle" || prop === "single") {
            return () => Promise.resolve({ data: rows(table)[0] ?? null, error: null });
          }
          return (...args: unknown[]) => {
            call.chain.push([prop, args]);
            return proxy;
          };
        },
      });
      return proxy;
    },
    rpc(name: string, args: Record<string, unknown> = {}) {
      rpcCalls.push(name);
      rpcArgs.push({ name, args });
      return Promise.resolve({ data: fakeRpc(name), error: null });
    },
  };
  return { db, calls, rpcCalls, rpcArgs };
}

function ctx(db: unknown): ToolContext {
  return { db, orgId: ORG, userId: "66666666-6666-4666-8666-666666666666", scopes: ["read"] };
}

const VALID_ARGS: Record<string, Record<string, unknown>> = {
  "lead.get": { id: LEAD },
  "lead.list": { query: "acme", pipeline_id: LEAD, stage_key: "novo" },
  "pipeline.list": {},
  "stage.list": { pipeline_id: LEAD },
  "conversation.get": { phone: "+55 (11) 99999-8888" },
  "whatsapp.instance_status": {},
  "metrics.catalog": {},
  "metrics.query": { metrics: ["receita", "ticket_medio", "cac"], period: "month" },
  "funnel.review": { pipeline_id: LEAD },
  "deal.move.plan": {
    moves: [{ entry_id: LEAD, to_stage_key: "proposta", reason: "pediu proposta" }],
  },
  "deal.move.confirm": { confirm_token: LEAD },
  "deal.move.undo": { undo_token: LEAD },
  "audience.preview": { pipeline_id: LEAD, idle_days_min: 3 },
  "broadcast.status": { blast_plan_id: LEAD },
  "broadcast.plan": {
    audience: { pipeline_id: LEAD, idle_days_min: 3 },
    message: "Oi {{primeiro_nome}}",
  },
  "broadcast.test": { message: "Oi {{primeiro_nome}}" },
  "broadcast.confirm": { confirm_token: LEAD },
  "broadcast.cancel": { blast_plan_id: LEAD },
  "automation.list": {},
  "automation.get": { workflow_id: LEAD },
  "automation.draft": {
    pipeline_id: LEAD,
    stage_key: "novo",
    idle_days: 3,
    message: "Oi {{primeiro_nome}}",
  },
  "automation.activate": { workflow_id: LEAD },
  "automation.deactivate": { workflow_id: LEAD },
};

/** Write tool → the scope it must declare. */
const WRITE_SCOPE: Record<string, string> = {
  "deal.move.plan": "crm:write",
  "deal.move.confirm": "crm:write",
  "deal.move.undo": "crm:write",
  "broadcast.plan": "messages:send",
  "broadcast.test": "messages:send",
  "broadcast.confirm": "messages:send",
  "broadcast.cancel": "messages:send",
  "automation.draft": "automations:write",
  "automation.activate": "automations:write",
  "automation.deactivate": "automations:write",
};
const WRITE_TOOLS = new Set(Object.keys(WRITE_SCOPE));

/** An action store that records calls and hands back a fixed plan. */
function fakeStore(plan: unknown = null) {
  const calls: string[] = [];
  return {
    calls,
    open: (tool: string) => {
      calls.push(`open:${tool}`);
      return Promise.resolve({
        actionId: "77777777-7777-4777-8777-777777777777",
        expiresAt: "2099-01-01T00:00:00Z",
      });
    },
    take: () => {
      calls.push("take");
      return Promise.resolve(plan ? { tool: "deal.move", plan } : null);
    },
    finish: () => {
      calls.push("finish");
      return Promise.resolve(true);
    },
    getApplied: () => Promise.resolve(null),
    markUndone: () => Promise.resolve(true),
  };
}

function writeCtx(db: unknown, store = fakeStore()): ToolContext {
  return {
    ...ctx(db),
    scopes: ["read", "crm:write", "messages:send", "automations:write"],
    actions: store,
    edge: () => Promise.resolve({ status: 500, body: null }),
  };
}

// --- surface invariants ----------------------------------------------------------------

Deno.test("surface: read tools are readonly; write tools declare a scope and are not marked read-only", () => {
  assertEquals(CUSTOMER_TOOLS.map((t) => t.name).sort(), Object.keys(VALID_ARGS).sort());
  for (const t of CUSTOMER_TOOLS) {
    assertEquals(t.customerExposed, true, t.name);
    assertEquals(t.inputSchema.additionalProperties, false, `${t.name} must reject unknown args`);
    if (WRITE_TOOLS.has(t.name)) {
      assertEquals(t.readonly, false, t.name);
      assertEquals(t.requiredScope, WRITE_SCOPE[t.name], t.name);
      assertEquals(t.annotations?.readOnlyHint, false, t.name);
    } else {
      assertEquals(t.readonly, true, t.name);
      assertEquals(t.requiredScope, undefined, t.name);
      assertEquals(t.annotations?.readOnlyHint, true, t.name);
    }
  }
  // apply/undo/send change data or reach people: the client must ask the human first
  for (
    const n of [
      "deal.move.confirm",
      "deal.move.undo",
      "broadcast.confirm",
      "broadcast.cancel",
      "automation.activate",
    ]
  ) {
    assertEquals(CUSTOMER_TOOLS.find((t) => t.name === n)?.annotations?.destructiveHint, true, n);
  }
});

Deno.test("scope filter: a read-only token never sees a write tool; a scoped one sees only its scope", () => {
  const readOnly = CUSTOMER_TOOLS.filter(customerToolFilter(["read"])).map((t) => t.name);
  for (const w of WRITE_TOOLS) assertEquals(readOnly.includes(w), false, w);
  const crm = CUSTOMER_TOOLS.filter(customerToolFilter(["read", "crm:write"])).map((t) => t.name);
  for (const w of WRITE_TOOLS) assertEquals(crm.includes(w), WRITE_SCOPE[w] === "crm:write", w);
  const auto = CUSTOMER_TOOLS.filter(customerToolFilter(["read", "automations:write"])).map((t) =>
    t.name
  );
  for (const w of WRITE_TOOLS) {
    assertEquals(auto.includes(w), WRITE_SCOPE[w] === "automations:write", w);
  }
  const msg = CUSTOMER_TOOLS.filter(customerToolFilter(["read", "messages:send"])).map((t) =>
    t.name
  );
  for (const w of WRITE_TOOLS) assertEquals(msg.includes(w), WRITE_SCOPE[w] === "messages:send", w);
  // fail-closed: a write tool that forgot its scope is invisible even to a full token
  const orphan = {
    ...CUSTOMER_TOOLS[0],
    name: "x.write",
    readonly: false,
    requiredScope: undefined,
  };
  assertEquals(
    customerToolFilter(["read", "crm:write", "messages:send", "automations:write"])(orphan),
    false,
  );
});

Deno.test("write tools refuse a token without the scope, before touching anything", async () => {
  for (const t of CUSTOMER_TOOLS.filter((x) => WRITE_TOOLS.has(x.name))) {
    const { db, calls, rpcCalls } = fakeDb();
    const store = fakeStore();
    const res = await t.handler(VALID_ARGS[t.name], {
      ...ctx(db),
      scopes: ["read"],
      actions: store,
    });
    assertEquals(res.isError, true, t.name);
    assertEquals(calls.length + rpcCalls.length + store.calls.length, 0, t.name);
  }
});

Deno.test("isolation: every tool filters by the TOKEN org on every table and RPC it touches", async () => {
  for (const t of CUSTOMER_TOOLS) {
    _resetCatalogCache();
    const { db, calls, rpcArgs } = fakeDb((table) =>
      table === "leads" ? [{ id: LEAD, normalized_phone: "11999998888" }] : []
    );
    await t.handler(VALID_ARGS[t.name], WRITE_TOOLS.has(t.name) ? writeCtx(db) : ctx(db));
    // confirm/undo with an unknown token stop at the store, before any query
    if (
      ["deal.move.confirm", "deal.move.undo", "broadcast.confirm", "broadcast.cancel"].includes(
        t.name,
      )
    ) continue;
    assertEquals(calls.length + rpcArgs.length > 0, true, `${t.name} made no query`);
    for (const c of calls) {
      // Reviewed exceptions: the caller's OWN memberships are read by user_id (to count their
      // orgs), and recipients of a broadcast only after its parent plan was found in the org.
      if (
        c.table === "team_members" && c.chain.some(([m, a]) => m === "eq" && a[0] === "user_id")
      ) {
        const hasOrg = c.chain.some(([m, a]) => m === "eq" && a[0] === "organization_id");
        if (!hasOrg) continue;
      }
      if (c.table === "blast_plan_recipients") continue;
      // `organizations` is keyed by its own id; every other table by organization_id.
      const col = c.table === "organizations" ? "id" : "organization_id";
      const orgEq = c.chain.find(([m, a]) => m === "eq" && a[0] === col);
      assertEquals(orgEq?.[1][1], ORG, `${t.name} → ${c.table} is not scoped to the token org`);
    }
    for (const r of rpcArgs) {
      if (r.name === "fn_metric_catalog") continue; // global catalog, takes no org
      const org = r.args.p_org_id;
      assertEquals(org, ORG, `${t.name} → rpc ${r.name} is not called with the token org`);
    }
  }
});

Deno.test("isolation: an org_id argument that differs from the token is refused before any query", async () => {
  for (const t of CUSTOMER_TOOLS) {
    const { db, calls, rpcCalls } = fakeDb();
    // tools whose schema has no org_id still get it through a lenient client; the guard holds
    const res = await t.handler(
      { ...VALID_ARGS[t.name], org_id: OTHER_ORG },
      WRITE_TOOLS.has(t.name) ? writeCtx(db) : ctx(db),
    );
    assertEquals(res.isError, true, t.name);
    assertEquals(calls.length + rpcCalls.length, 0, `${t.name} queried despite a foreign org_id`);
  }
});

Deno.test("anti-bypass: the RPC allowlist is exactly the reviewed set", () => {
  // Adding a function here is a security decision — see rpc.ts and
  // supabase/tests/crm_mcp_rpc_allowlist_test.sql, which proves each gate on the real DB.
  assertEquals(RPC_ALLOWLIST, {
    fn_metric_catalog: "invoker",
    fn_metric_measure: "definer:assert_org_access",
    has_feature_permission: "definer:auth.uid",
    mover_negocio: "invoker",
  });
});

Deno.test("anti-bypass: tools only reach Postgres functions through the allowlist", async () => {
  for (const t of CUSTOMER_TOOLS) {
    _resetCatalogCache();
    const { db, rpcCalls } = fakeDb(() => [{ id: LEAD, normalized_phone: "11999998888" }]);
    await t.handler(VALID_ARGS[t.name], WRITE_TOOLS.has(t.name) ? writeCtx(db) : ctx(db));
    for (const name of rpcCalls) {
      assertEquals(Object.hasOwn(RPC_ALLOWLIST, name), true, `${t.name} called ${name}`);
    }
  }
  // …and the source agrees: `.rpc(` lives only in rpc.ts (a path the fake did not exercise
  // still cannot hide a direct call).
  for await (const e of Deno.readDir(new URL("./", import.meta.url))) {
    if (!e.name.endsWith(".ts") || e.name.endsWith(".test.ts") || e.name === "rpc.ts") continue;
    const src = (await Deno.readTextFile(new URL(e.name, import.meta.url)))
      .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
      .replace(/\/\/.*$/gm, ""); // line comments — prose may say "never db.rpc (…)"
    assertEquals(/\.rpc\s*\(/.test(src), false, `${e.name} contains .rpc( — use callRpc`);
  }
});

Deno.test("whatsapp.instance_status never selects provider_config, qr_code or metadata", async () => {
  const t = CUSTOMER_TOOLS.find((x) => x.name === "whatsapp.instance_status")!;
  const { db, calls } = fakeDb();
  await t.handler({}, ctx(db));
  const select = String(calls[0].chain.find(([m]) => m === "select")?.[1][0]);
  for (const secret of ["provider_config", "qr_code", "metadata", "*"]) {
    assertEquals(select.includes(secret), false, secret);
  }
});

// --- lead.list --------------------------------------------------------------------------

Deno.test("parseLeadListArgs: phone-looking query → normalized phone; text → sanitized search", () => {
  const p = parseLeadListArgs({ query: "+55 (11) 9999-8888" }, ORG);
  assertEquals(p.ok && p.q.phone, "11999998888");
  const s = parseLeadListArgs({ query: "  Acme%_*  " }, ORG);
  assertEquals(s.ok && s.q.search, "Acme");
});

Deno.test("parseLeadListArgs: validation messages", () => {
  assertEquals(parseLeadListArgs({ pipeline_id: "x" }, ORG).ok, false);
  assertEquals(parseLeadListArgs({ stage_key: "novo" }, ORG).ok, false); // needs pipeline_id
  assertEquals(parseLeadListArgs({ created_after: "ontem" }, ORG).ok, false);
  assertEquals(parseLeadListArgs({ cursor: "garbage" }, ORG).ok, false);
  assertEquals(parseLeadListArgs({ query: "a" }, ORG).ok, false);
  const ok = parseLeadListArgs({ limit: 5000 }, ORG);
  assertEquals(ok.ok && ok.q.limit, 100);
});

Deno.test("leadListOrFilter: quotes user text, and ANDs search with the keyset explicitly", () => {
  const cursor = { createdAt: "2026-11-23T10:00:00.123+00:00", id: LEAD };
  const p = parseLeadListArgs({ query: "o'brien, (x)", cursor: encodeCursor(cursor) }, ORG);
  if (!p.ok) throw new Error(p.message);
  const f = leadListOrFilter(p.q)!;
  assertMatch(f, /^and\(or\(name\.ilike\."\*o'brien, \(x\)\*",/);
  assertMatch(f, /or\(created_at\.lt\."2026-11-23T10:00:00\.123\+00:00",and\(created_at\.eq\./);
});

// --- shared helpers ---------------------------------------------------------------------

Deno.test("pgrstQuote escapes quotes and backslashes", () => {
  assertEquals(pgrstQuote('a"b\\c'), '"a\\"b\\\\c"');
});

Deno.test("cursor round-trips and rejects tampering", () => {
  const c = { createdAt: "2026-11-23T10:00:00.000Z", id: LEAD };
  assertEquals(decodeCursor(encodeCursor(c)), c);
  assertEquals(decodeCursor(btoa(JSON.stringify(["2026-11-23", "not-uuid"]))), "invalid");
  assertEquals(decodeCursor(btoa(JSON.stringify(["x", LEAD]))), "invalid");
  assertEquals(decodeCursor(undefined), null);
});

Deno.test("combineOrGroups / clampLimit / optionalIsoDate / sanitizeSearch edges", () => {
  assertEquals(combineOrGroups([]), null);
  assertEquals(combineOrGroups(["a.eq.1"]), "a.eq.1");
  assertEquals(combineOrGroups(["a.eq.1", "b.eq.2"]), "and(or(a.eq.1),or(b.eq.2))");
  assertEquals(clampLimit("7", 25, 100), 7);
  assertEquals(clampLimit(-3, 25, 100), 1);
  assertEquals(clampLimit("x", 25, 100), 25);
  assertEquals(optionalIsoDate("2026-11-23"), "2026-11-23T00:00:00.000Z");
  assertEquals(optionalIsoDate("23/11/2026"), "invalid");
  assertEquals(sanitizeSearch(" % "), null);
});

Deno.test("jsonResult caps the payload so one call cannot flood the context", () => {
  const big = jsonResult({ s: "x".repeat(MAX_RESULT_CHARS * 2) });
  assertEquals(textOf(big).length < MAX_RESULT_CHARS + 100, true);
  assertMatch(textOf(big), /truncated/);
});

// --- conversation / whatsapp --------------------------------------------------------------

Deno.test("shapeThread: oldest first, who-said-what, clipped, no internals", () => {
  const out = shapeThread([
    {
      timestamp: "2026-11-23T10:01:00Z",
      created_at: null,
      direction: "outgoing",
      message_type: "text",
      content: "oi",
      transcription_text: null,
      push_name: "Loja",
      sent_by_ai: true,
    },
    {
      timestamp: "2026-11-23T10:00:00Z",
      created_at: null,
      direction: "incoming",
      message_type: "audio",
      content: null,
      transcription_text: "quero preço",
      push_name: "Ana",
      sent_by_ai: false,
    },
  ]);
  assertEquals(out[0], {
    at: "2026-11-23T10:00:00Z",
    from: "contact",
    type: "audio",
    text: null,
    transcription: "quero preço",
    name: "Ana",
  });
  assertEquals(out[1], {
    at: "2026-11-23T10:01:00Z",
    from: "us",
    by_ai: true,
    type: "text",
    text: "oi",
  });
});

Deno.test("instanceHealth: session_dead wins; connected only for connected statuses", () => {
  const base = {
    id: "i",
    instance_name: null,
    phone_number: null,
    provider: null,
    last_connection_at: null,
    session_dead_reason: null,
    reserved_for: null,
  };
  assertEquals(
    instanceHealth({ ...base, status: "connected", session_dead_since: null }),
    "connected",
  );
  assertEquals(
    instanceHealth({ ...base, status: "connected", session_dead_since: "2026-11-20T00:00:00Z" }),
    "session_dead",
  );
  assertEquals(
    instanceHealth({ ...base, status: "disconnected", session_dead_since: null }),
    "disconnected",
  );
});
