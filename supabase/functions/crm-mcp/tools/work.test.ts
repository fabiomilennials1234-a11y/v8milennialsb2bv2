import { assertEquals, assertMatch } from "@std/assert";
import { textOf } from "../../_shared/mcp/content.ts";
import type { ToolContext } from "../../_shared/mcp/types.ts";
import { customerLeadGetTool, customerLeadTimelineTool, mergeTimeline, shapeLead } from "./lead.ts";
import { addDays, localMidnightUtc } from "./shared.ts";
import { customerTeamListTool, TEAM_COLUMNS } from "./team.ts";
import {
  customerAgendaListTool,
  customerFollowupListTool,
  customerInboxAwaitingReplyTool,
  followupWindow,
} from "./work.ts";

const ORG = "33333333-3333-4333-8333-333333333333";
const LEAD = "55555555-5555-4555-8555-555555555555";
const ME = "66666666-6666-4666-8666-666666666666";

type Answer = { data?: unknown; error?: { message: string } | null };
type Call = { table: string; chain: Array<[string, unknown[]]> };

function fakeDb(
  tables: Record<string, Answer>,
  rpcs: Record<string, (a: Record<string, unknown>) => Answer> = {},
) {
  const calls: Call[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      const call: Call = { table, chain: [] };
      calls.push(call);
      const a = tables[table] ?? { data: [] };
      const resolve = (single: boolean) =>
        Promise.resolve({
          data: single && Array.isArray(a.data) ? a.data[0] ?? null : a.data ?? null,
          error: a.error ?? null,
        });
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
      if (name === "has_feature_permission" && !rpcs[name]) {
        return Promise.resolve({ data: true, error: null });
      }
      const a = rpcs[name]?.(args) ?? { data: null };
      return Promise.resolve({ data: a.data ?? null, error: a.error ?? null });
    },
  };
  return { db, calls, rpcCalls };
}

const ctxOf = (db: unknown): ToolContext => ({ db, orgId: ORG, userId: "u", scopes: ["read"] });
const has = (c: Call, method: string, ...args: unknown[]) =>
  c.chain.some(([m, a]) => m === method && args.every((x, i) => a[i] === x));
const json = async (p: Promise<{ content: unknown }> | { content: unknown }) =>
  JSON.parse(textOf(await p as never));

// --- calendar math --------------------------------------------------------------------------

Deno.test("localMidnightUtc: local midnight in the org's timezone, DST-safe", () => {
  assertEquals(
    localMidnightUtc("2026-11-24", "America/Sao_Paulo").toISOString(),
    "2026-11-24T03:00:00.000Z",
  );
  assertEquals(localMidnightUtc("2026-11-24", "UTC").toISOString(), "2026-11-24T00:00:00.000Z");
  // New York switches to winter time on 2026-11-01
  assertEquals(
    localMidnightUtc("2026-10-31", "America/New_York").toISOString(),
    "2026-10-31T04:00:00.000Z",
  );
  assertEquals(
    localMidnightUtc("2026-11-02", "America/New_York").toISOString(),
    "2026-11-02T05:00:00.000Z",
  );
  assertEquals(addDays("2026-12-31", 1), "2027-01-01");
});

Deno.test("followupWindow: overdue / today / upcoming in the org's calendar; open has no bounds", () => {
  const tz = "America/Sao_Paulo";
  assertEquals(followupWindow("overdue", "2026-11-24", tz, 7), { lt: "2026-11-24T03:00:00.000Z" });
  assertEquals(followupWindow("today", "2026-11-24", tz, 7), {
    gte: "2026-11-24T03:00:00.000Z",
    lt: "2026-11-25T03:00:00.000Z",
  });
  assertEquals(followupWindow("upcoming", "2026-11-24", tz, 2), {
    gte: "2026-11-24T03:00:00.000Z",
    lt: "2026-11-27T03:00:00.000Z",
  });
  assertEquals(followupWindow("open", "2026-11-24", tz, 7), {});
});

// --- followup.list --------------------------------------------------------------------------

Deno.test("followup.list: joins the lead INNER (its visibility), mine → the caller's member id, names the assignee", async () => {
  const f = fakeDb({
    organizations: { data: [{ timezone: "America/Sao_Paulo" }] },
    team_members: { data: [{ id: ME }] },
    follow_ups: {
      data: [{
        id: "f1",
        title: "Ligar",
        description: null,
        due_date: "2020-01-01T12:00:00Z",
        completed_at: null,
        priority: "high",
        assigned_to: ME,
        is_automated: false,
        deal_id: null,
        pipeline_entry_id: "e1",
        leads: { id: LEAD, name: "Ana", company: null, phone: null },
      }],
    },
    org_visible_members: { data: [{ id: ME, name: "Bruno" }] },
  });
  const out = await json(customerFollowupListTool.handler({ mine: true }, ctxOf(f.db)));
  const q = f.calls.find((c) => c.table === "follow_ups")!;
  assertMatch(String(q.chain.find(([m]) => m === "select")?.[1][0]), /leads!inner\(/);
  assertEquals(has(q, "eq", "assigned_to", ME), true);
  assertEquals(has(q, "is", "completed_at", null), true);
  assertEquals(out.followups[0].assigned_to, { id: ME, name: "Bruno" });
  assertEquals(out.followups[0].overdue, true);
  for (const c of f.calls) {
    const col = c.table === "organizations" ? "id" : "organization_id";
    assertEquals(has(c, "eq", col, ORG), true, c.table);
  }
});

Deno.test("followup.list: without followups.view nothing is read", async () => {
  const f = fakeDb({}, { has_feature_permission: () => ({ data: false }) });
  const res = await customerFollowupListTool.handler({}, ctxOf(f.db));
  assertEquals(res.isError, true);
  assertMatch(textOf(res), /followups\.view/);
  assertEquals(f.calls.length, 0);
});

Deno.test("followup.list: argument checks", async () => {
  const f = fakeDb({});
  for (
    const a of [{ when: "yesterday" }, { assigned_to: "x" }, { mine: true, assigned_to: ME }, {
      days_ahead: 0,
    }]
  ) {
    assertEquals((await customerFollowupListTool.handler(a, ctxOf(f.db))).isError, true);
  }
});

// --- agenda.list ----------------------------------------------------------------------------

Deno.test("agenda.list: the Agenda's own RPC over local-day bounds, sorted, filtered by source", async () => {
  const f = fakeDb(
    { organizations: { data: [{ timezone: "America/Sao_Paulo" }] } },
    {
      get_agenda_events_scoped: () => ({
        data: [
          {
            id: "b",
            source: "follow_up",
            title: "FUP",
            start_at: "2026-11-25T15:00:00Z",
            lead_id: null,
          },
          {
            id: "a",
            source: "meeting",
            title: "Demo",
            start_at: "2026-11-24T15:00:00Z",
            lead_id: LEAD,
            lead_name: "Ana",
            meet_link: "https://meet",
          },
        ],
      }),
    },
  );
  const out = await json(
    customerAgendaListTool.handler({ from: "2026-11-24", to: "2026-11-25" }, ctxOf(f.db)),
  );
  const call = f.rpcCalls.find((r) => r.name === "get_agenda_events_scoped")!;
  assertEquals(call.args, {
    p_organization_id: ORG,
    p_start: "2026-11-24T03:00:00.000Z",
    p_end: "2026-11-26T03:00:00.000Z", // `to` is inclusive
  });
  assertEquals(out.events.map((e: { id: string }) => e.id), ["a", "b"]);
  assertEquals([out.events[0].lead.id, out.events[0].lead.name], [LEAD, "Ana"]);
  const only = await json(
    customerAgendaListTool.handler({ from: "2026-11-24", sources: ["meeting"] }, ctxOf(f.db)),
  );
  assertEquals(only.events.map((e: { id: string }) => e.id), ["a"]);
});

Deno.test("agenda.list: refuses bad or too long ranges before calling the RPC", async () => {
  const f = fakeDb({ organizations: { data: [{ timezone: "UTC" }] } });
  for (
    const a of [{ from: "24/11/2026" }, { from: "2026-11-24", to: "2026-11-20" }, {
      from: "2026-01-01",
      to: "2026-12-31",
    }]
  ) {
    assertEquals((await customerAgendaListTool.handler(a, ctxOf(f.db))).isError, true);
  }
  assertEquals(f.rpcCalls.some((r) => r.name === "get_agenda_events_scoped"), false);
});

// --- inbox.awaiting_reply -------------------------------------------------------------------

Deno.test("inbox.awaiting_reply: the Comando queue for the token org, with minutes waiting", async () => {
  const at = new Date(Date.now() - 90 * 60_000).toISOString();
  const f = fakeDb({}, {
    get_comando_fila: () => ({
      data: [{
        instance_id: "i",
        phone_number: "5511",
        push_name: "Ana",
        lead_id: LEAD,
        conversation_id: "c",
        last_client_message: "Oi, e o orçamento?",
        last_client_message_at: at,
        ai_replied: true,
        owner_team_member_id: ME,
        owner_name: "Bruno",
        lead_name: "Ana Souza",
      }],
    }),
  });
  const out = await json(customerInboxAwaitingReplyTool.handler({ window_days: 3 }, ctxOf(f.db)));
  const call = f.rpcCalls.find((r) => r.name === "get_comando_fila")!;
  assertEquals(call.args, { p_org: ORG, p_instances: null, p_limit: 30, p_window_days: 3 });
  const c = out.conversations[0];
  assertEquals([c.lead.name, c.owner.name, c.ai_replied], ["Ana Souza", "Bruno", true]);
  assertEquals(c.waiting_minutes >= 89 && c.waiting_minutes <= 91, true);
});

Deno.test("inbox.awaiting_reply: without whatsapp.view the queue is not read", async () => {
  const f = fakeDb({}, { has_feature_permission: () => ({ data: false }) });
  const res = await customerInboxAwaitingReplyTool.handler({}, ctxOf(f.db));
  assertEquals(res.isError, true);
  assertEquals(f.rpcCalls.some((r) => r.name === "get_comando_fila"), false);
});

// --- team.list ------------------------------------------------------------------------------

Deno.test("team.list: names and roles only — never the pay columns team_members also holds", async () => {
  assertEquals(/ote_|commission|salary|email/.test(TEAM_COLUMNS), false);
  const f = fakeDb({ org_visible_members: { data: [{ id: ME, name: "Bruno" }] } });
  const out = await json(customerTeamListTool.handler({}, ctxOf(f.db)));
  assertEquals(out.members, [{ id: ME, name: "Bruno" }]);
  const q = f.calls[0];
  assertEquals([q.table, has(q, "eq", "organization_id", ORG), has(q, "eq", "is_active", true)], [
    "org_visible_members",
    true,
    true,
  ]);
});

// --- lead.get enrichment / lead.timeline ----------------------------------------------------

Deno.test("shapeLead: owner named, tags and custom fields flattened, join shapes dropped", () => {
  const out = shapeLead({
    id: LEAD,
    name: "Ana",
    responsible_user_id: ME,
    lead_tags: [{ tags: { id: "t1", name: "VIP" } }, { tags: null }],
    lead_custom_field_values: [
      { value: "SP", lead_custom_fields: { field_name: "Estado", field_type: "text" } },
      { value: "", lead_custom_fields: { field_name: "Vazio", field_type: "text" } },
      { value: "x", lead_custom_fields: null },
    ],
  }, "Bruno");
  assertEquals(out, {
    id: LEAD,
    name: "Ana",
    owner: { id: ME, name: "Bruno" },
    tags: [{ id: "t1", name: "VIP" }],
    custom_fields: [{ field: "Estado", type: "text", value: "SP" }],
  });
});

Deno.test("lead.get: enriched lead with the owner's name from the org's members", async () => {
  const f = fakeDb({
    leads: {
      data: [{
        id: LEAD,
        name: "Ana",
        responsible_user_id: ME,
        lead_tags: [],
        lead_custom_field_values: [],
      }],
    },
    org_visible_members: { data: [{ id: ME, name: "Bruno" }] },
  });
  const out = await json(customerLeadGetTool.handler({ id: LEAD }, ctxOf(f.db)));
  assertEquals(out.owner, { id: ME, name: "Bruno" });
  const sel = String(f.calls[0].chain.find(([m]) => m === "select")?.[1][0]);
  assertMatch(sel, /lead_tags\(tags\(id,name\)\)/);
  assertMatch(sel, /deals\(id,title,value/); // through the card, never deals directly
});

Deno.test("mergeTimeline: events and notes newest first, author names, cut with a 'more' flag", () => {
  const t = mergeTimeline(
    [
      {
        id: "h1",
        action: "stage_changed",
        description: "Novo → Proposta",
        source: "manual",
        entity_type: null,
        created_at: "2026-11-20T10:00:00Z",
      },
      {
        id: "h2",
        action: "workflow",
        description: "Automação X",
        source: "automation",
        entity_type: null,
        created_at: "2026-11-22T10:00:00Z",
      },
    ],
    [{
      id: "c1",
      body: "Pediu desconto",
      author_team_member_id: ME,
      pipeline_entry_id: null,
      created_at: "2026-11-21T10:00:00Z",
    }],
    new Map([[ME, "Bruno"]]),
    2,
  );
  assertEquals(t.items.map((i) => [i.kind, i.by]), [["event", "automation"], ["note", "Bruno"]]);
  assertEquals(t.more, true);
});

Deno.test("lead.timeline: a lead the person cannot see is 'not found' — history and notes are never read", async () => {
  const f = fakeDb({ leads: { data: [] } });
  const res = await customerLeadTimelineTool.handler({ lead_id: LEAD }, ctxOf(f.db));
  assertEquals(res.isError, true);
  assertEquals(f.calls.map((c) => c.table), ["leads"]);
});

Deno.test("lead.timeline: reads both sources in the token org, paged by `before`", async () => {
  const f = fakeDb({
    leads: { data: [{ id: LEAD, name: "Ana" }] },
    lead_history: {
      data: [{
        id: "h",
        action: "x",
        description: "d",
        source: "system",
        entity_type: null,
        created_at: "2026-11-02T00:00:00Z",
      }],
    },
    lead_comments: { data: [] },
  });
  const out = await json(
    customerLeadTimelineTool.handler(
      { lead_id: LEAD, before: "2026-11-10T00:00:00Z" },
      ctxOf(f.db),
    ),
  );
  assertEquals(out.count, 1);
  for (const t of ["lead_history", "lead_comments"]) {
    const c = f.calls.find((x) => x.table === t)!;
    assertEquals(has(c, "eq", "organization_id", ORG) && has(c, "eq", "lead_id", LEAD), true, t);
    const lt = c.chain.find(([m, a]) => m === "lt" && a[0] === "created_at");
    assertEquals(Date.parse(String(lt?.[1][1])), Date.parse("2026-11-10T00:00:00Z"), t);
  }
});

Deno.test("lead.list: owner_id narrows to that team member's leads (responsible_user_id)", async () => {
  const { customerLeadListTool, parseLeadListArgs } = await import("./lead.ts");
  assertEquals(parseLeadListArgs({ owner_id: "x" }, ORG).ok, false);
  const f = fakeDb({ leads: { data: [] } });
  await customerLeadListTool.handler({ owner_id: ME }, ctxOf(f.db));
  assertEquals(has(f.calls[0], "eq", "responsible_user_id", ME), true);
});
