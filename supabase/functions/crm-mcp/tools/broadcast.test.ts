import { assertEquals, assertMatch } from "@std/assert";
import { textOf } from "../../_shared/mcp/content.ts";
import type { ToolContext } from "../../_shared/mcp/types.ts";
import type { WorkflowDefinition } from "../../_shared/workflow-schema/definition.ts";
import {
  checkBroadcastText,
  clock,
  customerBroadcastConfirmTool,
  customerBroadcastPlanTool,
  customerBroadcastTestTool,
  eligibleInstances,
  engineMedia,
  estimateDays,
  idleOrFilter,
  inSendWindow,
  parseAudience,
  parseFromAutomation,
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

// --- what is sent: free text or an automation step (fatia 5) ------------------------------

const WF = "88888888-8888-4888-8888-888888888888";
const INST = "99999999-9999-4999-8999-999999999999";
const MEDIA = "https://proj.supabase.co/storage/v1/object/public/media/workflow-assets/org/a.jpeg";

Deno.test("checkBroadcastText: present, within the limit, only variables the engine fills", () => {
  assertEquals(
    checkBroadcastText("Oi {{primeiro_nome}} da {{empresa}} ({segmento}) {a|b}", false),
    null,
  );
  assertEquals(checkBroadcastText("", false), "message is required.");
  assertMatch(checkBroadcastText("", true)!, /legenda/);
  assertMatch(checkBroadcastText("x".repeat(1001), false)!, /1000/);
  const bad = checkBroadcastText(
    "{{saudacao}} {{nome}}, reunião {{dia_reuniao}} {{dia_reuniao}}",
    false,
  )!;
  assertMatch(bad, /usa \{\{saudacao\}\}, \{\{dia_reuniao\}\}, que chegaria em branco/);
});

Deno.test("parseFromAutomation: absent is null; both ids required", () => {
  assertEquals(parseFromAutomation(undefined), { ok: true, ref: null });
  assertEquals(parseFromAutomation({ workflow_id: WF, node_id: " n7 " }), {
    ok: true,
    ref: { workflowId: WF, nodeId: "n7" },
  });
  assertEquals(parseFromAutomation({ workflow_id: "x", node_id: "n7" }).ok, false);
  assertEquals(parseFromAutomation({ workflow_id: WF }).ok, false);
  assertEquals(parseFromAutomation({ workflow_id: WF, node_id: "n".repeat(101) }).ok, false);
});

Deno.test("engineMedia: the attachment fields blast-plan-create validates", () => {
  assertEquals(engineMedia(null), {});
  assertEquals(engineMedia({ type: "image", url: MEDIA, name: null }), {
    media_url: MEDIA,
    media_type: "image",
  });
  assertEquals(engineMedia({ type: "document", url: MEDIA, name: "P.pdf" }), {
    media_url: MEDIA,
    media_type: "document",
    media_name: "P.pdf",
  });
});

/** An automation shaped like the ones the builder saves (trigger → wait → sends). */
const AUTOMATION: WorkflowDefinition = {
  nodes: [
    { id: "n1", type: "trigger", data: { label: "Entrou em Follow-up" } },
    { id: "n2", type: "delay", data: { label: "Esperar 1 dia" } },
    {
      id: "n3",
      type: "action",
      data: {
        actionType: "send_whatsapp_message",
        messageType: "texto",
        messageTemplate: "Oi {{primeiro_nome}}, conseguiu ver minha mensagem?",
        label: "Cobrar resposta",
      },
    },
    {
      id: "n4",
      type: "action",
      data: {
        actionType: "send_whatsapp_image",
        imageUrl: MEDIA,
        imageCaption: "Esse é um dos anúncios que fizemos pra {{empresa}}",
      },
    },
    { id: "n5", type: "action", data: { actionType: "send_whatsapp_image", imageUrl: MEDIA } },
    { id: "n6", type: "action", data: { actionType: "send_whatsapp_audio", audioUrl: MEDIA } },
    {
      id: "n7",
      type: "action",
      data: { actionType: "send_whatsapp", messageTemplate: "Sua reunião é {{dia_reuniao}}" },
    },
  ],
  edges: ["n1-n2", "n2-n3", "n3-n4", "n4-n5", "n5-n6", "n6-n7"].map((e, i) => {
    const [source, target] = e.split("-");
    return { id: String(i), source, target };
  }),
};

/** Table-driven PostgREST stand-in + recording store/edge, for plan and test. */
function contentFakes() {
  const calls: Array<{ table: string; chain: Array<[string, unknown[]]> }> = [];
  const opened: Array<{ tool: string; summary: string; plan: Record<string, unknown> }> = [];
  const edgeCalls: Array<{ fn: string; body: Record<string, unknown> }> = [];
  const rows = (table: string): unknown[] => {
    switch (table) {
      case "team_members":
        return [{ organization_id: ORG, name: "Ana Souza", phone: "(11) 99999-0000" }];
      case "workflows":
        return [{ id: WF, name: "GPM · 2. Follow-up", definition: AUTOMATION }];
      case "pipeline_entries":
        return ["l1", "l2"].map((id) => ({
          lead_id: id,
          leads: {
            id,
            name: id === "l1" ? "Bruno Lima" : "Carla Dias",
            company: "Acme",
            segment: null,
            normalized_phone: "5511988887777",
            deleted_at: null,
          },
        }));
      case "whatsapp_instances":
        return [{
          id: INST,
          instance_name: "lucca",
          phone_number: "5511900000000",
          status: "connected",
          provider: "uazapi",
          reserved_for: null,
        }];
      default:
        return [];
    }
  };
  const db = {
    from(table: string) {
      const call = { table, chain: [] as Array<[string, unknown[]]> };
      calls.push(call);
      const p: unknown = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === "then") {
            return (res: (v: unknown) => unknown) =>
              Promise.resolve({ data: rows(table), error: null }).then(res);
          }
          if (prop === "maybeSingle" || prop === "single") {
            return () => Promise.resolve({ data: rows(table)[0] ?? null, error: null });
          }
          return (...args: unknown[]) => {
            call.chain.push([prop, args]);
            return p;
          };
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
      open: (tool: string, _scope: string, summary: string, plan: Record<string, unknown>) => {
        opened.push({ tool, summary, plan });
        return Promise.resolve({ actionId: TOKEN, expiresAt: "2099-01-01T00:00:00Z" });
      },
      take: () => Promise.resolve({ tool: "broadcast.test", plan: null }),
      finish: () => Promise.resolve(true),
    },
    edge: (fn: string, body: Record<string, unknown>) => {
      edgeCalls.push({ fn, body });
      return Promise.resolve({ status: 200, body: { ok: true } });
    },
  };
  return { ctx, calls, opened, edgeCalls };
}

const AUDIENCE = { pipeline_id: PIPE, stage_keys: ["follow_up"] };
async function planOf(args: Record<string, unknown>) {
  const f = contentFakes();
  const res = await customerBroadcastPlanTool.handler({ audience: AUDIENCE, ...args }, f.ctx);
  return { f, res };
}

Deno.test("plan from_automation: the server copies the step's text and image — the AI never retypes it", async () => {
  const { f, res } = await planOf({ from_automation: { workflow_id: WF, node_id: "n4" } });
  const out = JSON.parse(textOf(res));
  assertEquals(f.opened.length, 1);
  const plan = f.opened[0].plan;
  assertEquals(plan.message, "Esse é um dos anúncios que fizemos pra {{empresa}}");
  assertEquals(plan.media, { type: "image", url: MEDIA, name: null });
  assertEquals(plan.from_automation, { workflow_id: WF, node_id: "n4" });
  assertMatch(f.opened[0].summary, /automação "GPM · 2\. Follow-up"/);
  assertEquals(out.examples[0].text, "Esse é um dos anúncios que fizemos pra Acme");
  assertEquals(out.from_automation.automation, "GPM · 2. Follow-up");
  // the automation is read inside the token's org
  const wf = f.calls.find((c) => c.table === "workflows")!;
  assertEquals(
    wf.chain.some(([m, a]) => m === "eq" && a[0] === "organization_id" && a[1] === ORG),
    true,
  );
});

Deno.test("plan from_automation: `message` replaces only the text; the media stays", async () => {
  const { f } = await planOf({
    from_automation: { workflow_id: WF, node_id: "n5" },
    message: "Lembra desse anúncio, {{primeiro_nome}}?",
  });
  assertEquals(f.opened[0].plan.message, "Lembra desse anúncio, {{primeiro_nome}}?");
  assertEquals((f.opened[0].plan.media as { url: string }).url, MEDIA);
});

Deno.test("plan from_automation: an image without caption asks for the text instead of failing in the engine", async () => {
  const { f, res } = await planOf({ from_automation: { workflow_id: WF, node_id: "n5" } });
  assertEquals(res.isError, true);
  assertMatch(textOf(res), /legenda/);
  assertEquals(f.opened.length, 0);
});

Deno.test("plan from_automation: steps the Disparo cannot send are refused with the reason", async () => {
  const cases: Array<[string, RegExp]> = [
    ["n6", /áudio/],
    ["n7", /\{\{dia_reuniao\}\}/],
    ["n2", /não envia mensagem/], // a wait, not a send
    ["nope", /não existe/],
  ];
  for (const [node, why] of cases) {
    const { f, res } = await planOf({ from_automation: { workflow_id: WF, node_id: node } });
    assertEquals(res.isError, true, node);
    assertMatch(textOf(res), why);
    assertEquals(f.opened.length, 0, node);
  }
});

Deno.test("plan: free text with a variable the engine would blank is refused before any query", async () => {
  const f = contentFakes();
  const res = await customerBroadcastPlanTool.handler(
    { audience: AUDIENCE, message: "Oi {{saudacao}}" },
    f.ctx,
  );
  assertEquals(res.isError, true);
  assertMatch(textOf(res), /\{\{saudacao\}\}/);
  assertEquals([f.calls.length, f.opened.length], [0, 0]);
  // neither text nor automation → nothing to send
  const none = await customerBroadcastPlanTool.handler({ audience: AUDIENCE }, f.ctx);
  assertEquals(none.isError, true);
});

Deno.test("test from_automation: the image goes too, captioned for the caller", async () => {
  const f = contentFakes();
  const res = await customerBroadcastTestTool.handler(
    { from_automation: { workflow_id: WF, node_id: "n4" } },
    f.ctx,
  );
  assertEquals(res.isError, undefined);
  assertEquals(f.edgeCalls.length, 1);
  const { fn, body } = f.edgeCalls[0];
  assertEquals(fn, "whatsapp-api-proxy");
  assertEquals(body.action, "sendMedia");
  assertEquals(body.payload, {
    number: "5511999990000",
    type: "image",
    file: MEDIA,
    caption: "Esse é um dos anúncios que fizemos pra ",
  });
});

Deno.test("test: plain text still goes through sendText", async () => {
  const f = contentFakes();
  await customerBroadcastTestTool.handler({ message: "Oi {{primeiro_nome}}" }, f.ctx);
  assertEquals(f.edgeCalls[0].body.action, "sendText");
  assertEquals((f.edgeCalls[0].body.payload as { text: string }).text, "Oi Ana");
});

Deno.test("confirm: media, the audience's funnel and the automation reference reach the engine", () =>
  atNoon(async () => {
    const f = fakes({
      plan: {
        ...PLAN,
        media: { type: "document", url: MEDIA, name: "Proposta.pdf" },
        audience: { pipelineId: PIPE, stageKeys: ["follow_up"], idleDaysMin: 0 },
        from_automation: { workflow_id: WF, node_id: "n4" },
      },
    });
    await customerBroadcastConfirmTool.handler({ confirm_token: TOKEN }, f.ctx);
    const body = f.edgeCalls[0].body as Record<string, unknown>;
    assertEquals([body.media_url, body.media_type, body.media_name], [
      MEDIA,
      "document",
      "Proposta.pdf",
    ]);
    assertEquals(body.source, {
      via: "crm-mcp",
      action_id: TOKEN,
      pipelineId: PIPE,
      from_automation: { workflow_id: WF, node_id: "n4" },
    });
  }));

Deno.test("confirm: a plan stored before this change is sent exactly as before", () =>
  atNoon(async () => {
    const f = fakes({ plan: PLAN });
    await customerBroadcastConfirmTool.handler({ confirm_token: TOKEN }, f.ctx);
    const body = f.edgeCalls[0].body as Record<string, unknown>;
    assertEquals("media_url" in body, false);
    assertEquals(body.source, { via: "crm-mcp", action_id: TOKEN });
  }));
