import { assertEquals, assertMatch } from "@std/assert";
import { textOf } from "../../_shared/mcp/content.ts";
import type { ToolContext } from "../../_shared/mcp/types.ts";
import {
  buildIdleAutomation,
  customerAutomationActivateTool,
  customerAutomationDraftTool,
  customerAutomationGetTool,
  idleAutomationSpec,
} from "./automation.ts";

const ORG = "33333333-3333-4333-8333-333333333333";
const PIPE = "44444444-4444-4444-8444-444444444444";
const STAGE = "66666666-6666-4666-8666-666666666666";
const WF = "99999999-9999-4999-8999-999999999999";
const TOKEN = "77777777-7777-4777-8777-777777777777";

const INPUT = {
  name: "Parado 3d em Proposta → WhatsApp",
  pipelineId: PIPE,
  stageId: STAGE,
  stageName: "Proposta",
  idleDays: 3,
  message: "Oi {{primeiro_nome}}, conseguiu ver a proposta?",
};

Deno.test("spec: entered stage → wait N days → still there N+ days → WhatsApp", () => {
  const spec = idleAutomationSpec(INPUT);
  assertEquals(spec.trigger, {
    type: "stage_changed",
    config: { pipeline_id: PIPE, to_stage: STAGE },
  });
  const [delay, still] = spec.steps as unknown as Array<Record<string, unknown>>;
  assertEquals([delay.kind, delay.amount, delay.unit], ["delay", 3, "days"]);
  assertEquals([still.field, still.operator, still.value], ["stage_id", "equals", STAGE]);
  const idle = (still.then as Array<Record<string, unknown>>)[0];
  assertEquals([idle.field, idle.operator, idle.value], ["days_in_stage", "greater_or_equal", 3]);
  const send = (idle.then as Array<Record<string, unknown>>)[0];
  assertEquals([send.actionType, (send.config as { messageTemplate: string }).messageTemplate], [
    "send_whatsapp",
    INPUT.message,
  ]);
});

Deno.test("build: passes the shared parser, compiler and validator; saved OFF; app step cap", () => {
  const b = buildIdleAutomation(INPUT);
  assertEquals(b.ok, true);
  if (!b.ok) return;
  assertEquals(b.row.is_active, false);
  assertEquals(b.row.trigger_type, "stage_changed");
  // loop_limit is the executor's max STEPS per execution — 1 would stop at the first node
  assertEquals(b.row.loop_limit, 100);
  assertEquals(b.nodes >= 5, true); // trigger, delay, 2 conditions, action
});

// --- handlers over fakes ------------------------------------------------------------------

function fakes(opts: { canCreate?: boolean; stage?: unknown; plan?: unknown; updated?: number }) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; row: Record<string, unknown> }> = [];
  const store: string[] = [];
  const db = {
    rpc(name: string) {
      return Promise.resolve({
        data: name === "has_feature_permission" ? opts.canCreate !== false : null,
        error: null,
      });
    },
    from(table: string) {
      const b: Record<string, unknown> = {};
      const p: unknown = new Proxy(b, {
        get(_t, prop: string) {
          if (prop === "insert") {
            return (row: Record<string, unknown>) => {
              inserts.push({ table, row });
              return p;
            };
          }
          if (prop === "update") {
            return (row: Record<string, unknown>) => {
              updates.push({ table, row });
              return p;
            };
          }
          if (prop === "single") return () => Promise.resolve({ data: { id: WF }, error: null });
          if (prop === "maybeSingle") {
            return () =>
              Promise.resolve({
                data: table === "pipeline_stages"
                  ? (opts.stage === undefined ? { id: STAGE, name: "Proposta" } : opts.stage)
                  : { id: WF, name: "W", description: "d", is_active: false },
                error: null,
              });
          }
          if (prop === "then") {
            return (res: (v: unknown) => unknown) =>
              Promise.resolve({
                data: Array.from({ length: opts.updated ?? 1 }, () => ({ id: WF })),
                error: null,
              }).then(
                res,
              );
          }
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
    scopes: ["read", "automations:write"],
    actions: {
      open: () => {
        store.push("open");
        return Promise.resolve({ actionId: TOKEN, expiresAt: "x" });
      },
      take: () => {
        store.push("take");
        return Promise.resolve(
          opts.plan === null ? null : {
            tool: opts.plan ? "automation.activate" : "automation.draft",
            plan: opts.plan ?? {},
          },
        );
      },
      finish: (_id: string, status: string) => {
        store.push(`finish:${status}`);
        return Promise.resolve(true);
      },
    },
  };
  return { ctx, inserts, updates, store };
}

const DRAFT = { pipeline_id: PIPE, stage_key: "proposta", idle_days: 3, message: INPUT.message };

Deno.test("draft: saves the compiled automation OFF, in the token's org, audited", async () => {
  const f = fakes({});
  const res = JSON.parse(textOf(await customerAutomationDraftTool.handler(DRAFT, f.ctx)));
  assertEquals([res.workflow_id, res.active], [WF, false]);
  const wf = f.inserts.find((i) => i.table === "workflows")!.row;
  assertEquals([wf.organization_id, wf.is_active, wf.created_by], [ORG, false, "u"]);
  assertEquals(f.store, ["open", "take", "finish:applied"]);
});

Deno.test("draft: without workflows.create nothing is written", async () => {
  const f = fakes({ canCreate: false });
  const res = await customerAutomationDraftTool.handler(DRAFT, f.ctx);
  assertEquals(res.isError, true);
  assertMatch(textOf(res), /workflows\.create/);
  assertEquals([f.inserts.length, f.store.length], [0, 0]);
});

Deno.test("draft: a stage that is not in the funnel is refused", async () => {
  const f = fakes({ stage: null });
  const res = await customerAutomationDraftTool.handler(DRAFT, f.ctx);
  assertEquals(res.isError, true);
  assertEquals(f.inserts.length, 0);
});

Deno.test("activate: plan first (nothing turned on), then confirm turns ON only the planned one", async () => {
  const planF = fakes({});
  const plan = JSON.parse(
    textOf(await customerAutomationActivateTool.handler({ workflow_id: WF }, planF.ctx)),
  );
  assertEquals(plan.confirm_token, TOKEN);
  assertEquals(planF.updates.length, 0);

  const f = fakes({ plan: { workflow_id: WF } });
  const res = JSON.parse(
    textOf(await customerAutomationActivateTool.handler({ confirm_token: TOKEN }, f.ctx)),
  );
  assertEquals(res.active, true);
  assertEquals(f.updates[0].row, { is_active: true });
  assertEquals(f.store, ["take", "finish:applied"]);
});

Deno.test("activate: an unknown/used/expired token turns nothing on", async () => {
  const f = fakes({ plan: null });
  const res = await customerAutomationActivateTool.handler({ confirm_token: TOKEN }, f.ctx);
  assertEquals(res.isError, true);
  assertEquals(f.updates.length, 0);
});

// --- automation.get (fatia 5) ---------------------------------------------------------------

const MEDIA = "https://proj.supabase.co/storage/v1/object/public/media/workflow-assets/org/a.jpeg";

/** Read fake: an automation shaped like production ones, firing on a stage by its id. */
function readFakes(opts: { trigger?: Record<string, unknown>; triggerType?: string } = {}) {
  const calls: Array<{ table: string; chain: Array<[string, unknown[]]> }> = [];
  const rows = (table: string): unknown[] => {
    if (table === "workflows") {
      return [{
        id: WF,
        name: "GPM · 2. Follow-up (nunca respondeu)",
        description: null,
        is_active: true,
        trigger_type: opts.triggerType ?? "stage_changed",
        trigger_config: opts.trigger ?? { pipeline_id: PIPE, stages: [STAGE], to_stage: "" },
        updated_at: "2026-11-20T12:00:00Z",
        definition: {
          nodes: [
            { id: "n1", type: "trigger", data: { label: "Entrou em Follow-up" } },
            {
              id: "n2",
              type: "action",
              data: {
                actionType: "send_whatsapp_message",
                messageType: "texto",
                messageTemplate: "Oi {{primeiro_nome}}, conseguiu ver minha mensagem?",
              },
            },
            {
              id: "n3",
              type: "action",
              data: { actionType: "send_whatsapp_image", imageUrl: MEDIA, imageCaption: "Olha" },
            },
          ],
          edges: [
            { id: "e1", source: "n1", target: "n2" },
            { id: "e2", source: "n2", target: "n3" },
          ],
        },
      }];
    }
    if (table === "pipelines") return [{ id: PIPE, name: "GPM" }];
    if (table === "pipeline_stages") {
      return [
        { id: STAGE, stage_key: "follow_up", name: "Follow-up" },
        { id: "x", stage_key: "novo", name: "Novo" },
      ];
    }
    return [];
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
          if (prop === "maybeSingle") {
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
  return { db, calls };
}

const readCtx = (db: unknown, scopes: string[]): ToolContext => ({
  db,
  orgId: ORG,
  userId: "u",
  scopes,
});

async function getOf(db: unknown, scopes = ["read", "messages:send"]) {
  return JSON.parse(
    textOf(await customerAutomationGetTool.handler({ workflow_id: WF }, readCtx(db, scopes))),
  );
}

Deno.test("automation.get: trigger by name, messages with node_id, and the audience for cards already there", async () => {
  const f = readFakes();
  const out = await getOf(f.db);
  assertEquals(out.trigger.pipeline, { id: PIPE, name: "GPM" });
  assertEquals(out.trigger.stages, [{ id: STAGE, stage_key: "follow_up", name: "Follow-up" }]);
  assertEquals(out.messages.map((m: { node_id: string; kind: string }) => [m.node_id, m.kind]), [
    ["n2", "texto"],
    ["n3", "imagem"],
  ]);
  assertEquals(out.messages[0].broadcastable, true);
  assertEquals(out.to_cards_already_in_stage.audience, {
    pipeline_id: PIPE,
    stage_keys: ["follow_up"],
  });
  // every table it reads is scoped to the token's org
  for (const c of f.calls) {
    assertEquals(
      c.chain.some(([m, a]) => m === "eq" && a[0] === "organization_id" && a[1] === ORG),
      true,
      c.table,
    );
  }
});

Deno.test("automation.get: without messages:send it says exactly how to unlock the broadcast", async () => {
  const out = await getOf(readFakes().db, ["read"]);
  assertMatch(out.to_cards_already_in_stage, /"Enviar mensagens"/);
  assertMatch(out.to_cards_already_in_stage, /admin/);
  assertEquals(out.messages.length, 2); // reading is never gated
});

Deno.test("automation.get: a trigger that is not a funnel stage gets no audience", async () => {
  const f = readFakes({
    triggerType: "lead_created",
    trigger: { filter_pipeline_id: PIPE, filter_pipe: "" },
  });
  const out = await getOf(f.db);
  assertEquals(out.trigger.pipeline.name, "GPM");
  assertEquals(typeof out.to_cards_already_in_stage, "string");
});

Deno.test("automation.get: a legacy trigger with no funnel keeps raw stage refs and reads nothing else", async () => {
  const f = readFakes({ trigger: { pipe_type: "whatsapp", stages: ["respondeu"] } });
  const out = await getOf(f.db);
  assertEquals(out.trigger.pipeline, null);
  assertEquals(out.trigger.stages, [{ ref: "respondeu" }]);
  assertEquals(f.calls.map((c) => c.table), ["workflows"]);
});

Deno.test("automation.get: a malformed id is refused before any query", async () => {
  const f = readFakes();
  const bad = await customerAutomationGetTool.handler(
    { workflow_id: "x" },
    readCtx(f.db, ["read"]),
  );
  assertEquals([bad.isError, f.calls.length], [true, 0]);
});
