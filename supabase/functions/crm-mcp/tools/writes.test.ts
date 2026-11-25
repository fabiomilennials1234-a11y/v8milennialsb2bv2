/**
 * Fatia 8 — writes by AI: notes, follow-ups, tags, deal outcomes, one message. Each test pins
 * the order that matters: visibility (through `leads`) and permission BEFORE any write, the
 * exact payload, and the audit trail.
 */
import { assertEquals, assertMatch } from "@std/assert";
import { textOf } from "../../_shared/mcp/content.ts";
import type { ToolContext } from "../../_shared/mcp/types.ts";
import {
  customerFollowupCompleteTool,
  customerFollowupCreateTool,
  customerLeadTagConfirmTool,
  customerLeadTagPlanTool,
  customerNoteAddTool,
  diffTags,
  parseDue,
  resolveTags,
} from "./lead-write.ts";
import {
  customerMessageConfirmTool,
  customerMessagePlanTool,
  pickInstance,
  waNumber,
} from "./message.ts";
import {
  customerDealOutcomeConfirmTool,
  customerDealOutcomePlanTool,
  judgeOutcome,
  parseOutcomes,
} from "./outcome.ts";

const ORG = "33333333-3333-4333-8333-333333333333";
/** Three days ahead (a fixed far date would trip the "two years ahead" guard). */
const SOON = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
const SOON_AT_9 = new Date(Date.parse(`${SOON}T12:00:00Z`)).toISOString(); // 09:00 São Paulo
const LEAD = "55555555-5555-4555-8555-555555555555";
const LEAD2 = "55555555-5555-4555-8555-555555555556";
const ME = "66666666-6666-4666-8666-666666666666";
const USER = "99999999-9999-4999-8999-999999999999";
const E1 = "77777777-7777-4777-8777-777777777771";
const TOKEN = "88888888-8888-4888-8888-888888888888";
const INST = "44444444-4444-4444-8444-444444444441";

type Answer = { data?: unknown; error?: { message: string; code?: string } | null };
type Call = { table: string; chain: Array<[string, unknown[]]> };

function fakeDb(
  tables: Record<string, Answer | ((c: Call) => Answer)>,
  rpcs: Record<string, (a: Record<string, unknown>) => Answer> = {},
) {
  const calls: Call[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      const call: Call = { table, chain: [] };
      calls.push(call);
      const answer = () => {
        const a = tables[table];
        return (typeof a === "function" ? a(call) : a) ?? { data: [] };
      };
      const resolve = (single: boolean) => {
        const a = answer();
        return Promise.resolve({
          data: single && Array.isArray(a.data) ? a.data[0] ?? null : a.data ?? null,
          error: a.error ?? null,
        });
      };
      const p: unknown = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === "then") return (res: (v: unknown) => unknown) => resolve(false).then(res);
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
      const a = rpcs[name]?.(args) ?? (name === "has_feature_permission" ? { data: true } : {});
      return Promise.resolve({ data: a.data ?? null, error: a.error ?? null });
    },
  };
  return { db, calls, rpcCalls };
}

function store(plan: { tool: string; plan: unknown } | null = null) {
  const log: string[] = [];
  const opened: Array<{ tool: string; plan: unknown }> = [];
  const finished: Array<{ status: string; result: unknown }> = [];
  return {
    log,
    opened,
    finished,
    open: (tool: string, _s: string, _sum: string, p: unknown) => {
      log.push(`open:${tool}`);
      opened.push({ tool, plan: p });
      return Promise.resolve({ actionId: TOKEN, expiresAt: "2099-01-01T00:00:00Z" });
    },
    take: () => {
      log.push("take");
      return Promise.resolve(plan ?? { tool: "x", plan: null });
    },
    finish: (_id: string, status: string, result: unknown) => {
      log.push(`finish:${status}`);
      finished.push({ status, result });
      return Promise.resolve(true);
    },
    getApplied: () => Promise.resolve(null),
    markUndone: () => Promise.resolve(true),
  };
}

const ctxOf = (db: unknown, s = store(), extra: Partial<ToolContext> = {}): ToolContext => ({
  db,
  orgId: ORG,
  userId: USER,
  scopes: ["read", "crm:write", "messages:send"],
  actions: s,
  ...extra,
});
const arg = (c: Call, method: string) => c.chain.find(([m]) => m === method)?.[1];
const has = (c: Call, method: string, ...args: unknown[]) =>
  c.chain.some(([m, a]) => m === method && args.every((x, i) => a[i] === x));
const json = (r: { content: unknown }) => JSON.parse(textOf(r as never));
const deny = { has_feature_permission: () => ({ data: false }) };

// --- note.add --------------------------------------------------------------------------------

Deno.test("note.add: authored by the caller, on a lead they can see, audited", async () => {
  const f = fakeDb({
    leads: { data: [{ id: LEAD, name: "Ana" }] },
    team_members: { data: [{ id: ME }] },
    lead_comments: { data: [{ id: "n1" }] },
  });
  const s = store();
  const out = json(
    await customerNoteAddTool.handler(
      { lead_id: LEAD, text: " Pediu proposta até sexta ", entry_id: E1 },
      ctxOf(f.db, s),
    ),
  );
  assertEquals([out.added, out.note_id], [true, "n1"]);
  const ins = f.calls.find((c) => c.table === "lead_comments")!;
  assertEquals(arg(ins, "insert")?.[0], {
    organization_id: ORG,
    lead_id: LEAD,
    author_user_id: USER,
    author_team_member_id: ME,
    body: "Pediu proposta até sexta",
    pipeline_entry_id: E1,
  });
  assertEquals(s.log, ["open:note.add", "take", "finish:applied"]);
});

Deno.test("note.add: a lead the person cannot see is never written to", async () => {
  const f = fakeDb({ leads: { data: [] }, team_members: { data: [{ id: ME }] } });
  const s = store();
  const res = await customerNoteAddTool.handler({ lead_id: LEAD, text: "x" }, ctxOf(f.db, s));
  assertEquals(res.isError, true);
  assertEquals(f.calls.some((c) => c.table === "lead_comments"), false);
  assertEquals(s.log, []);
});

// --- follow-ups ----------------------------------------------------------------------------

Deno.test("parseDue: date = 09:00 local; local datetime; explicit zone; past and far future refused", () => {
  const tz = "America/Sao_Paulo";
  const now = new Date("2026-11-25T15:00:00Z"); // 12:00 in São Paulo
  assertEquals(parseDue("2026-11-26", tz, now), { ok: true, iso: "2026-11-26T12:00:00.000Z" });
  assertEquals(parseDue("2026-11-26T14:30", tz, now), {
    ok: true,
    iso: "2026-11-26T17:30:00.000Z",
  });
  assertEquals(parseDue("2026-11-26T14:30:00Z", tz, now), {
    ok: true,
    iso: "2026-11-26T14:30:00.000Z",
  });
  // earlier today is fine (it becomes due now); yesterday is not
  assertEquals(parseDue("2026-11-25T08:00", tz, now).ok, true);
  assertEquals(parseDue("2026-11-24", tz, now).ok, false);
  assertEquals(parseDue("2029-01-01", tz, now).ok, false);
  assertEquals(parseDue("amanhã", tz, now).ok, false);
});

const fuTables = (extra: Record<string, Answer> = {}) => ({
  leads: { data: [{ id: LEAD, name: "Ana" }] },
  organizations: { data: [{ timezone: "America/Sao_Paulo" }] },
  team_members: { data: [{ id: ME }] },
  follow_ups: { data: [{ id: "fu1" }] },
  org_visible_members: { data: [{ id: ME, name: "Bruno" }] },
  ...extra,
});

Deno.test("followup.create: defaults to the caller, 09:00 local, priority normal; audited", async () => {
  const f = fakeDb(fuTables());
  const s = store();
  const out = json(
    await customerFollowupCreateTool.handler(
      { lead_id: LEAD, title: "Ligar sobre a proposta", due_at: SOON },
      ctxOf(f.db, s),
    ),
  );
  const ins = arg(f.calls.find((c) => c.table === "follow_ups")!, "insert")?.[0] as Record<
    string,
    unknown
  >;
  assertEquals(
    [
      ins.organization_id,
      ins.lead_id,
      ins.assigned_to,
      ins.priority,
      ins.due_date,
      ins.is_automated,
    ],
    [ORG, LEAD, ME, "normal", SOON_AT_9, false],
  );
  assertEquals(out.assigned_to, { id: ME, name: "Bruno" });
  assertEquals(s.log, ["open:followup.create", "take", "finish:applied"]);
});

Deno.test("followup.create: assignee must be an active member; permission followups.create", async () => {
  const notMember = fakeDb(fuTables({ org_visible_members: { data: [] } }));
  const r1 = await customerFollowupCreateTool.handler(
    { lead_id: LEAD, title: "x", due_at: SOON, assigned_to: LEAD2 },
    ctxOf(notMember.db),
  );
  assertEquals(r1.isError, true);
  assertEquals(notMember.calls.some((c) => c.table === "follow_ups"), false);
  const denied = fakeDb(fuTables(), deny);
  const r2 = await customerFollowupCreateTool.handler(
    { lead_id: LEAD, title: "x", due_at: SOON },
    ctxOf(denied.db),
  );
  assertMatch(textOf(r2), /followups\.create/);
  assertEquals(denied.calls.length, 0);
});

Deno.test("followup.complete: through the lead; already done is a no-op; an update hitting no row is an error", async () => {
  const done = fakeDb({
    follow_ups: { data: [{ id: "fu1", title: "x", completed_at: "2026-11-20T00:00:00Z" }] },
  });
  const r1 = json(
    await customerFollowupCompleteTool.handler({ followup_id: TOKEN }, ctxOf(done.db)),
  );
  assertEquals(r1.note, "Já estava concluído.");
  assertEquals(done.calls.filter((c) => has(c, "update")).length, 0);
  assertMatch(String(arg(done.calls[0], "select")?.[0]), /leads!inner/);

  const raced = fakeDb({
    follow_ups: (c) =>
      c.chain.some(([m]) => m === "update")
        ? { data: [] } // someone completed it in between: 200 with zero rows
        : { data: [{ id: "fu1", title: "x", completed_at: null }] },
  });
  const s = store();
  const r2 = await customerFollowupCompleteTool.handler(
    { followup_id: TOKEN, notes: "Cliente atendeu" },
    ctxOf(raced.db, s),
  );
  assertEquals(r2.isError, true);
  assertEquals(s.log, ["open:followup.complete", "take", "finish:failed"]);
});

// --- tags ----------------------------------------------------------------------------------

Deno.test("resolveTags / diffTags: names case-insensitive or ids; only real changes", () => {
  const catalog = [{ id: "t1", name: "VIP" }, { id: "t2", name: "Frio" }];
  assertEquals(resolveTags(["vip", "t2", "VIP", "Quente"], catalog), {
    tags: catalog,
    unknown: ["Quente"],
  });
  const d = diffTags(
    [{ id: "a", tag_ids: ["t1"] }, { id: "b", tag_ids: ["t2"] }],
    [catalog[0]],
    [catalog[1]],
  );
  assertEquals(d, {
    adds: [{ lead_id: "b", tag_id: "t1" }],
    removes: [{ lead_id: "b", tag_id: "t2" }],
  });
});

const tagTables = (extra: Record<string, Answer> = {}) => ({
  tags: { data: [{ id: "t1", name: "VIP" }] },
  leads: {
    data: [{ id: LEAD, name: "Ana", lead_tags: [] }, {
      id: LEAD2,
      name: "Bia",
      lead_tags: [{ tag_id: "t1" }],
    }],
  },
  workflows: {
    data: [
      { id: "w1", name: "Boas-vindas VIP", trigger_config: { tag_name: "vip" } },
      { id: "w2", name: "Outra tag", trigger_config: { tag_name: "Frio" } },
      { id: "w3", name: "Qualquer tag", trigger_config: {} },
    ],
  },
  ...extra,
});

Deno.test("lead.tag.plan: skips leads that already have it; names the automations the engine's matcher would fire", async () => {
  const f = fakeDb(tagTables());
  const s = store();
  const out = json(
    await customerLeadTagPlanTool.handler(
      { lead_ids: [LEAD, LEAD2], add: ["vip"] },
      ctxOf(f.db, s),
    ),
  );
  assertEquals(out.add, [{ lead: "Ana", tag: "VIP" }]);
  assertEquals(out.automations_fired_by_added_tags, [{
    tag: "VIP",
    automations: ["Boas-vindas VIP", "Qualquer tag"],
  }]);
  assertEquals(s.opened[0].plan, { adds: [{ lead_id: LEAD, tag_id: "t1" }], removes: [] });
});

Deno.test("lead.tag.plan: unknown tag, unreadable automations or no leads.edit store nothing", async () => {
  for (
    const [tables, rpcs] of [
      [tagTables(), {}],
      [tagTables({ workflows: { error: { message: "timeout" } } }), {}],
      [tagTables(), deny],
    ] as Array<[Record<string, Answer>, Record<string, (a: Record<string, unknown>) => Answer>]>
  ) {
    const s = store();
    const res = await customerLeadTagPlanTool.handler(
      { lead_ids: [LEAD], add: rpcs === deny || tables.workflows?.error ? ["VIP"] : ["Quente"] },
      ctxOf(fakeDb(tables, rpcs).db, s),
    );
    assertEquals(res.isError, true);
    assertEquals(s.log, []);
  }
});

Deno.test("lead.tag.confirm: adds as ON CONFLICT DO NOTHING, removes grouped by tag, audited", async () => {
  const f = fakeDb({ lead_tags: { data: [{ id: "x" }] } });
  const s = store({
    tool: "lead.tag",
    plan: {
      adds: [{ lead_id: LEAD, tag_id: "t1" }],
      removes: [{ lead_id: LEAD, tag_id: "t2" }, { lead_id: LEAD2, tag_id: "t2" }],
    },
  });
  const out = json(
    await customerLeadTagConfirmTool.handler({ confirm_token: TOKEN }, ctxOf(f.db, s)),
  );
  const up = f.calls.find((c) => has(c, "upsert"))!;
  assertEquals(arg(up, "upsert"), [[{ lead_id: LEAD, tag_id: "t1" }], {
    onConflict: "lead_id,tag_id",
    ignoreDuplicates: true,
  }]);
  const del = f.calls.filter((c) => has(c, "delete"));
  assertEquals(del.length, 1);
  assertEquals(arg(del[0], "in"), ["lead_id", [LEAD, LEAD2]]);
  assertEquals(out.applied, true);
  assertEquals(s.log, ["take", "finish:applied"]);
});

// --- deal outcome ---------------------------------------------------------------------------

Deno.test("parseOutcomes / judgeOutcome: unseen blocked, no-op skipped, a valueless sale warned", () => {
  assertEquals(parseOutcomes([{ entry_id: E1, outcome: "ganho" }]).ok, false);
  assertEquals(
    parseOutcomes([{ entry_id: E1, outcome: "won" }, { entry_id: E1, outcome: "lost" }]).ok,
    false,
  );
  const card = (
    outcome: string | null,
    value: number | null,
    sale_value: string | null = null,
  ) => ({
    id: E1,
    lead_id: LEAD,
    stage_key: "proposta",
    sale_value,
    leads: { name: "Ana" },
    deals: { outcome, value },
  });
  assertEquals(judgeOutcome({ entry_id: E1, outcome: "won" }, undefined).kind, "block");
  assertEquals(judgeOutcome({ entry_id: E1, outcome: "won" }, card("won", 10)).kind, "skip");
  const warned = judgeOutcome({ entry_id: E1, outcome: "won" }, card("open", null));
  assertEquals([warned.kind, "warning" in warned], ["apply", true]);
  // the card's own sale_value and an explicit 0 count as a value
  assertEquals(
    "warning" in judgeOutcome({ entry_id: E1, outcome: "won" }, card(null, null, "1500")),
    false,
  );
  assertEquals(
    "warning" in judgeOutcome({ entry_id: E1, outcome: "won", value: 0 }, card(null, null)),
    false,
  );
});

Deno.test("deal.outcome.plan: cards read under RLS in the token org; only applicable items are stored", async () => {
  const f = fakeDb({
    pipeline_entries: {
      data: [{
        id: E1,
        lead_id: LEAD,
        stage_key: "p",
        sale_value: null,
        leads: { name: "Ana" },
        deals: { outcome: "open", value: 900 },
      }],
    },
  });
  const s = store();
  const out = json(
    await customerDealOutcomePlanTool.handler(
      {
        items: [{ entry_id: E1, outcome: "lost", loss_reason: "Preço" }, {
          entry_id: TOKEN,
          outcome: "won",
        }],
      },
      ctxOf(f.db, s),
    ),
  );
  assertEquals(has(f.calls[0], "eq", "organization_id", ORG), true);
  assertEquals(s.opened[0].plan, {
    items: [{ entry_id: E1, outcome: "lost", loss_reason: "Preço" }],
  });
  assertEquals(out.not_applied[0].kind, "block");
  assertEquals(f.rpcCalls.some((r) => r.name === "definir_desfecho_da_entrada"), false);
});

Deno.test("deal.outcome.confirm: permission re-checked before the plan is consumed; RPC only for stored items; partial reported", async () => {
  const denied = store({ tool: "deal.outcome", plan: { items: [] } });
  const r0 = await customerDealOutcomeConfirmTool.handler(
    { confirm_token: TOKEN },
    ctxOf(fakeDb({}, deny).db, denied),
  );
  assertEquals([r0.isError, denied.log], [true, []]);

  const f = fakeDb({}, {
    definir_desfecho_da_entrada: (a) =>
      a.p_entry_id === E1
        ? { data: { outcome: "won", idempotent: false } }
        : { error: { message: "venda sem valor" } },
  });
  const s = store({
    tool: "deal.outcome",
    plan: {
      items: [{ entry_id: E1, outcome: "won", value: 100 }, { entry_id: TOKEN, outcome: "won" }],
    },
  });
  const out = json(
    await customerDealOutcomeConfirmTool.handler({ confirm_token: TOKEN }, ctxOf(f.db, s)),
  );
  const calls = f.rpcCalls.filter((r) => r.name === "definir_desfecho_da_entrada");
  assertEquals(calls[0].args, {
    p_entry_id: E1,
    p_outcome: "won",
    p_loss_reason: null,
    p_valor: 100,
  });
  assertEquals([out.applied, out.failed], [1, 1]);
  assertEquals(s.log.at(-1), "finish:partial");
});

// --- message --------------------------------------------------------------------------------

const inst = (id: string, extra = {}) => ({
  id,
  instance_name: id,
  phone_number: null,
  status: "connected",
  provider: "uazapi",
  reserved_for: null,
  ...extra,
});

Deno.test("pickInstance / waNumber: the conversation's number first; never a disconnected or official one", () => {
  const rows = [
    inst("sector", { reserved_for: "collections" }),
    inst("main"),
    inst("off", { status: "disconnected" }),
    inst("meta", { provider: "meta" }),
  ];
  assertEquals(pickInstance(rows, null, "sector"), { ok: true, instance: rows[0] }); // where the lead talks
  assertEquals(pickInstance(rows, null, "off"), { ok: true, instance: rows[1] }); // fallback, not reserved
  assertEquals(pickInstance(rows, "meta", null).ok, false);
  assertEquals(pickInstance([inst("x", { status: "disconnected" })], null, null).ok, false);
  assertEquals([
    waNumber("11999990000", null),
    waNumber(null, "+55 (11) 99999-0000"),
    waNumber(null, "123"),
  ], [
    "5511999990000",
    "5511999990000",
    null,
  ]);
});

Deno.test("message.plan: resolves variables, picks the conversation's number, stores the exact text", async () => {
  const f = fakeDb({
    leads: {
      data: [{
        id: LEAD,
        name: "Ana Souza",
        company: "Acme",
        segment: null,
        phone: null,
        normalized_phone: "5511999990000",
      }],
    },
    whatsapp_instances: { data: [inst(INST), inst("other")] },
    whatsapp_messages: { data: [{ instance_id: INST }] },
  });
  const s = store();
  const out = json(
    await customerMessagePlanTool.handler(
      { lead_id: LEAD, text: "Oi {{primeiro_nome}}, a proposta da {{empresa}} sai amanhã." },
      ctxOf(f.db, s),
    ),
  );
  assertEquals(out.text, "Oi Ana, a proposta da Acme sai amanhã.");
  assertEquals(s.opened[0].plan, {
    lead_id: LEAD,
    number: "5511999990000",
    text: "Oi Ana, a proposta da Acme sai amanhã.",
    instance_id: INST,
  });
});

Deno.test("message.plan: unsupported variable or no whatsapp.send_messages → refused before any read", async () => {
  const f1 = fakeDb({});
  const r1 = await customerMessagePlanTool.handler({
    lead_id: LEAD,
    text: "Sua reunião é {{dia_reuniao}}",
  }, ctxOf(f1.db));
  assertEquals([r1.isError, f1.calls.length, f1.rpcCalls.length], [true, 0, 0]);
  const f2 = fakeDb({}, deny);
  const r2 = await customerMessagePlanTool.handler({ lead_id: LEAD, text: "Oi" }, ctxOf(f2.db));
  assertMatch(textOf(r2), /whatsapp\.send_messages/);
  assertEquals(f2.calls.length, 0);
});

Deno.test("message.confirm: sends the STORED text through the proxy as the user, with org and lead", async () => {
  const edgeCalls: Array<{ fn: string; body: unknown }> = [];
  const s = store({
    tool: "message.send",
    plan: { lead_id: LEAD, number: "5511999990000", text: "Oi Ana", instance_id: INST },
  });
  const ok = json(
    await customerMessageConfirmTool.handler(
      { confirm_token: TOKEN },
      ctxOf(fakeDb({}).db, s, {
        edge: (fn: string, body: unknown) => {
          edgeCalls.push({ fn, body });
          return Promise.resolve({ status: 200, body: { ok: true } });
        },
      }),
    ),
  );
  assertEquals(ok.sent, true);
  assertEquals(edgeCalls[0], {
    fn: "whatsapp-api-proxy",
    body: {
      action: "sendText",
      instance_id: INST,
      organization_id: ORG,
      payload: { number: "5511999990000", text: "Oi Ana", lead_id: LEAD },
    },
  });
  assertEquals(s.log, ["take", "finish:applied"]);

  const bad = store({
    tool: "message.send",
    plan: { lead_id: LEAD, number: "1", text: "x", instance_id: INST },
  });
  const res = await customerMessageConfirmTool.handler(
    { confirm_token: TOKEN },
    ctxOf(fakeDb({}).db, bad, {
      edge: () => Promise.resolve({ status: 403, body: { error: "Conversa de outro dono" } }),
    }),
  );
  assertEquals(res.isError, true);
  assertMatch(textOf(res), /outro dono/);
  assertEquals(bad.log, ["take", "finish:failed"]);
});
