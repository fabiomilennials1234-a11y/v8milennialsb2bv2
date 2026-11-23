import { assertEquals } from "@std/assert";
import { textOf } from "../../_shared/mcp/content.ts";
import type { ToolContext } from "../../_shared/mcp/types.ts";
import {
  customerDealMoveConfirmTool,
  customerDealMoveUndoTool,
  daysSince,
  type EntryRow,
  judgeMove,
  parseMoves,
  type PlannedMove,
  stageKind,
  type StageRow,
  tailByPhone,
  workflowWouldFire,
} from "./funnel.ts";

const ORG = "33333333-3333-4333-8333-333333333333";
const PIPE = "44444444-4444-4444-8444-444444444444";
const E1 = "55555555-5555-4555-8555-555555555551";
const E2 = "55555555-5555-4555-8555-555555555552";
const TOKEN = "77777777-7777-4777-8777-777777777777";

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
const STAGES = [
  stage("novo"),
  stage("proposta"),
  stage("ganho", { stage_role: "won", requires_sale_value: true }),
  stage("perdido", { is_final_negative: true }),
];
const entry = (over: Partial<EntryRow> = {}): EntryRow => ({
  id: E1,
  pipeline_id: PIPE,
  stage_key: "novo",
  lead_id: "lead-1",
  closed_at: null,
  sale_value: null,
  leads: { name: "Ana" },
  ...over,
});

// --- pure ------------------------------------------------------------------------------

Deno.test("parseMoves: needs a UUID card, a stage and a reason; no repeats; caps at 100", () => {
  const ok = parseMoves([{
    entry_id: E1,
    to_stage_key: "proposta",
    reason: "pediu proposta",
    sale_value: "1500.555",
  }]);
  assertEquals(ok.ok && ok.moves[0].sale_value, 1500.56);
  assertEquals(parseMoves([]).ok, false);
  assertEquals(parseMoves([{ entry_id: "x", to_stage_key: "a", reason: "abc" }]).ok, false);
  assertEquals(parseMoves([{ entry_id: E1, to_stage_key: "a", reason: "" }]).ok, false);
  assertEquals(
    parseMoves([{ entry_id: E1, to_stage_key: "a", reason: "abc", sale_value: -1 }]).ok,
    false,
  );
  assertEquals(
    parseMoves([
      { entry_id: E1, to_stage_key: "a", reason: "abc" },
      { entry_id: E1, to_stage_key: "b", reason: "abc" },
    ]).ok,
    false,
  );
  assertEquals(parseMoves(Array.from({ length: 101 }, () => ({}))).ok, false);
});

Deno.test("judgeMove: the stage rules the app enforces, decided before anything changes", () => {
  const req = (to: string, extra = {}) => ({
    entry_id: E1,
    to_stage_key: to,
    reason: "motivo",
    ...extra,
  });
  assertEquals(judgeMove(req("proposta"), undefined, STAGES).kind, "block"); // not visible
  assertEquals(judgeMove(req("proposta"), entry({ closed_at: "2026-01-01" }), STAGES).kind, "skip");
  assertEquals(judgeMove(req("novo"), entry(), STAGES).kind, "skip"); // already there
  assertEquals(judgeMove(req("inexistente"), entry(), STAGES).kind, "block");
  assertEquals(judgeMove(req("ganho"), entry(), STAGES).kind, "block"); // requires value
  assertEquals(judgeMove(req("ganho", { sale_value: 0 }), entry(), STAGES).kind, "move"); // zero is a value
  assertEquals(judgeMove(req("ganho"), entry({ sale_value: "900" }), STAGES).kind, "move"); // value already on the card
  assertEquals(judgeMove(req("perdido"), entry(), STAGES).kind, "block"); // loss needs a reason
  const lost = judgeMove(req("perdido", { loss_reason: "sem orçamento" }), entry(), STAGES);
  assertEquals(lost.kind === "move" && lost.move.loss_reason, "sem orçamento");
  const ok = judgeMove(req("proposta"), entry(), STAGES);
  assertEquals(ok.kind === "move" && [ok.move.from_stage, ok.move.to_stage, ok.move.lead_name], [
    "novo",
    "proposta",
    "Ana",
  ]);
  // a stage of ANOTHER funnel with the same key is not a valid target
  const other = [stage("proposta", { pipeline_id: "outro" })];
  assertEquals(judgeMove(req("proposta"), entry(), other).kind, "block");
});

Deno.test("workflowWouldFire mirrors the builder's stage_changed keys", () => {
  const m = { pipeline_id: PIPE, from_stage: "novo", to_stage: "proposta" } as PlannedMove;
  const wf = (trigger_config: Record<string, unknown>) => ({ id: "w", name: "W", trigger_config });
  assertEquals(workflowWouldFire(wf({}), m), true); // any stage
  assertEquals(workflowWouldFire(wf({ pipeline_id: PIPE, to_stage: "proposta" }), m), true);
  assertEquals(workflowWouldFire(wf({ to_stage: "ganho" }), m), false);
  assertEquals(workflowWouldFire(wf({ pipeline_id: "outro" }), m), false);
  assertEquals(workflowWouldFire(wf({ from_stage: "proposta" }), m), false);
  assertEquals(workflowWouldFire(wf({ stages: ["ganho"] }), m), false);
});

Deno.test("tailByPhone: last N per phone, oldest first, compact", () => {
  const rows = [3, 2, 1].map((i) => ({
    normalized_phone: "11",
    timestamp: `2026-11-2${i}T00:00:00Z`,
    direction: i % 2 ? "incoming" : "outgoing",
    message_type: "text",
    content: `m${i}`,
    transcription_text: null,
  }));
  const t = tailByPhone(rows, 2).get("11")!;
  assertEquals(t.map((x) => x.text), ["m2", "m3"]);
  assertEquals(t[1].from, "contact");
});

Deno.test("stageKind / daysSince", () => {
  assertEquals(stageKind(STAGES[2]), "won");
  assertEquals(stageKind(STAGES[3]), "lost");
  assertEquals(stageKind(STAGES[0]), "open");
  assertEquals(daysSince("2026-11-20T00:00:00Z", Date.parse("2026-11-23T12:00:00Z")), 3);
  assertEquals(daysSince(null, 0), null);
});

// --- confirm / undo over fakes ------------------------------------------------------------

function fakes(opts: { plan?: unknown; applied?: unknown; stageOf: Record<string, string> }) {
  const rpc: Array<{ name: string; args: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; row: unknown }> = [];
  const store: string[] = [];
  const db = {
    rpc(name: string, args: Record<string, unknown>) {
      rpc.push({ name, args });
      if (name === "has_feature_permission") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: args.p_entry_id, error: null });
    },
    from(table: string) {
      let id: string | null = null;
      const b: Record<string, unknown> = {};
      const p: unknown = new Proxy(b, {
        get(_t, prop: string) {
          if (prop === "insert") {
            return (row: unknown) => {
              inserts.push({ table, row });
              return Promise.resolve({ data: null, error: null });
            };
          }
          if (prop === "maybeSingle") {
            return () =>
              Promise.resolve({
                data: id
                  ? { id, stage_key: opts.stageOf[id], closed_at: null, metadata: {} }
                  : null,
                error: null,
              });
          }
          if (prop === "then") {
            return (res: (v: unknown) => unknown) =>
              Promise.resolve({ data: [{ id }], error: null }).then(res);
          }
          return (...args: unknown[]) => {
            if (prop === "eq" && args[0] === "id") id = String(args[1]);
            return p;
          };
        },
      });
      return p;
    },
  };
  const actions = {
    open: () => {
      store.push("open");
      return Promise.resolve({ actionId: "88888888-8888-4888-8888-888888888888", expiresAt: "x" });
    },
    take: () => {
      store.push("take");
      if (store.filter((s) => s === "open").length) {
        return Promise.resolve({ tool: "deal.move.undo", plan: {} });
      }
      return Promise.resolve(opts.plan ? { tool: "deal.move", plan: opts.plan } : null);
    },
    finish: (_id: string, status: string) => {
      store.push(`finish:${status}`);
      return Promise.resolve(true);
    },
    getApplied: () =>
      Promise.resolve(opts.applied ? { tool: "deal.move", plan: {}, result: opts.applied } : null),
    markUndone: () => {
      store.push("undone");
      return Promise.resolve(true);
    },
  };
  const ctx: ToolContext = {
    db,
    orgId: ORG,
    userId: "u",
    scopes: ["read", "crm:write"],
    patId: "p",
    actions,
  };
  return { ctx, rpc, inserts, store };
}

const planned = (id: string, from: string, to: string): PlannedMove => ({
  entry_id: id,
  pipeline_id: PIPE,
  lead_id: `lead-${id}`,
  lead_name: id === E1 ? "Ana" : "Bruno",
  from_stage: from,
  to_stage: to,
  to_stage_name: to.toUpperCase(),
  reason: "avançou na conversa",
});

Deno.test("confirm: applies only the STORED plan, skips a card that moved meanwhile, audits", async () => {
  const f = fakes({
    plan: { moves: [planned(E1, "novo", "proposta"), planned(E2, "novo", "proposta")] },
    stageOf: { [E1]: "novo", [E2]: "ganho" }, // E2 was moved by someone after the plan
  });
  const res = JSON.parse(
    textOf(await customerDealMoveConfirmTool.handler({ confirm_token: TOKEN }, f.ctx)),
  );
  assertEquals(res.status, "partial");
  assertEquals(res.moved, 1);
  assertEquals(res.failed[0].why, "card mudou de etapa desde o plano");
  const moves = f.rpc.filter((r) => r.name === "mover_negocio");
  assertEquals(moves.length, 1);
  assertEquals([moves[0].args.p_entry_id, moves[0].args.p_target_stage_key], [E1, "proposta"]);
  const hist = f.inserts.filter((i) => i.table === "lead_history");
  assertEquals(hist.length, 1);
  assertEquals((hist[0].row as { source: string }).source, "agent");
  assertEquals(f.store, ["take", "finish:partial"]);
});

Deno.test("confirm: an unknown/used/expired plan changes nothing", async () => {
  const f = fakes({ plan: null, stageOf: {} });
  const res = await customerDealMoveConfirmTool.handler({ confirm_token: TOKEN }, f.ctx);
  assertEquals(res.isError, true);
  assertEquals(f.rpc.filter((r) => r.name === "mover_negocio").length, 0);
});

Deno.test("undo: moves back only cards still where the AI put them, and audits the undo", async () => {
  const f = fakes({
    applied: {
      moved: [
        { entry_id: E1, pipeline_id: PIPE, from_stage: "novo", to_stage: "proposta", lead: "Ana" },
        {
          entry_id: E2,
          pipeline_id: PIPE,
          from_stage: "novo",
          to_stage: "proposta",
          lead: "Bruno",
        },
      ],
    },
    stageOf: { [E1]: "proposta", [E2]: "ganho" }, // E2 advanced since: keep it
  });
  const res = JSON.parse(
    textOf(await customerDealMoveUndoTool.handler({ undo_token: TOKEN }, f.ctx)),
  );
  assertEquals([res.returned, res.kept.length], [1, 1]);
  const back = f.rpc.filter((r) => r.name === "mover_negocio");
  assertEquals([back[0].args.p_entry_id, back[0].args.p_target_stage_key], [E1, "novo"]);
  assertEquals(f.store.includes("undone"), true);
});
