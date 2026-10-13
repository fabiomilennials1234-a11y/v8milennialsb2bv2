// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- dublês de Supabase/OpenRouter: forma estrutural, não tipada */
/**
 * AgentEngine.processMessage ponta a ponta — N tool_calls por turno, handoff
 * por etapa (`intent_detection.stage_handoff`), allowlist de `notify_phones`,
 * mídia × handoff do mesmo turno e automação × ADVANCE_STAGE.
 *
 * Dublês: Supabase (fake que grava TODAS as escritas/RPC e simula o UNIQUE de
 * idempotency_key em pending_ai_actions; phone_ai_preferences muda de estado
 * quando o RPC transfer_lead_to_human roda) + OpenRouter (respostas
 * roteirizadas). Reais: action-plan, decide-action (enqueueToolAction /
 * automação / stage update), ai-queue.enqueueAiAction, immediateTransferHuman
 * + moveLeadToHumanStage, cancellation, same-turn-handoff, pipeline-adapter,
 * state-machine, dispatcher, message-sanitizer.
 *
 * Origem: harness de QA do CP-v4 (A–H), promovido a teste permanente.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const envStub: Record<string, string> = {
  SUPABASE_URL: "https://local.test",
  SUPABASE_SERVICE_ROLE_KEY: "x",
  OPENROUTER_API_KEY: "x",
};
vi.stubGlobal("Deno", {
  env: { get: (k: string) => envStub[k], toObject: () => ({ ...envStub }) },
  serve: () => {},
});

const runtimeLogs: any[] = [];
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn(async (e: unknown) => { runtimeLogs.push(e); }),
  redactSecrets: (v: unknown) => v,
}));
vi.mock("../../supabase/functions/_shared/embeddings.ts", () => ({ generateEmbedding: vi.fn(async () => [0]) }));
vi.mock("../../supabase/functions/_shared/track.ts", () => ({ trackEvent: vi.fn(async () => {}) }));
vi.mock("../../supabase/functions/_shared/ai-action-executor.ts", async () => {
  const real = await vi.importActual<any>("../../supabase/functions/_shared/actions/transfer-human.ts");
  return { immediateTransferHuman: real.immediateTransferHuman };
});

const ctl: { caps: any; lead: any; conv: any } = { caps: null, lead: null, conv: null };
vi.mock("../../supabase/functions/agent-message/engine/load-context.ts", () => ({
  loadCapabilities: vi.fn(async () => structuredClone(ctl.caps)),
  loadOrgCustomFields: vi.fn(async () => []),
  loadPipelineStages: vi.fn(async () => []),
  loadDocumentSummaries: vi.fn(async () => []),
  loadConversation: vi.fn(async () => ({ ...ctl.conv })),
  loadLeadData: vi.fn(async () => structuredClone(ctl.lead)),
  loadProductCatalog: vi.fn(async () => ""),
  loadConversationContextSummary: vi.fn(async () => null),
  getDefaultContext: vi.fn(() => null),
  retrieveSemanticContext: vi.fn(async () => ""),
  retrieveLongTermMemories: vi.fn(async () => ""),
  executeSearchKnowledge: vi.fn(async () => "kb"),
}));
vi.mock("../../supabase/functions/agent-message/engine/build-prompt.ts", () => ({
  buildDynamicPrompt: vi.fn(async () => "SYSTEM"),
}));
vi.mock("../../supabase/functions/agent-message/engine/build-tools.ts", () => ({
  buildDynamicTools: vi.fn(async () => []),
}));
vi.mock("../../supabase/functions/agent-message/engine/history.ts", () => ({
  loadConversationContext: vi.fn(async () => null),
  getConversationHistory: vi.fn(async () => []),
}));
vi.mock("../../supabase/functions/agent-message/engine/persist-response.ts", () => ({
  createConversation: vi.fn(async () => ({ ...ctl.conv })),
  saveConversationContext: vi.fn(async () => {}),
  updateContextSummaryAfterTurn: vi.fn(async () => {}),
  extractAndSaveMemories: vi.fn(async () => {}),
}));
vi.mock("../../supabase/functions/_shared/copilot/context-extractor.ts", () => ({
  extractConversationContext: vi.fn(async () => null),
}));

const { AgentEngine } = await import("../../supabase/functions/agent-message/agent-engine.ts");

// ── Fake Supabase ────────────────────────────────────────────────────────────
const ORG = "org-macerados";
const LEAD = "lead-1111";
const CONV = "conv-2222";
const PIPE_ID = "11111111-2222-3333-4444-555555555555";
const LEAD_PHONE = "+55 11 98888-0000";
const DISABLED_AT = "2026-10-13T12:00:00.123456+00:00";

type Pref = { ai_disabled: boolean; human_paused_until: string | null; set_by: string | null; set_at: string } | null;
type PrefScript = { before: Pref; after: Pref };
const PREF_ENABLED: Pref = { ai_disabled: false, human_paused_until: null, set_by: null, set_at: "2026-01-01T00:00:00+00:00" };
const PREF_HANDOFF: Pref = { ai_disabled: true, human_paused_until: null, set_by: null, set_at: DISABLED_AT };

type Op = { table: string; op: string; payload?: any; filters: any[]; single?: boolean };
function makeFake(prefs: PrefScript) {
  const ops: Op[] = [];
  const rpcs: Array<{ fn: string; args: any }> = [];
  const queue: any[] = []; // pending_ai_actions realmente inseridos
  const idem = new Set<string>();
  let transferred = false;
  let seq = 0;

  function resolve(s: Op): { data: any; error: any } {
    if (s.table === "pending_ai_actions" && s.op === "insert") {
      const k = s.payload.idempotency_key;
      if (k && idem.has(k)) return { data: null, error: { code: "23505", message: "dup" } };
      if (k) idem.add(k);
      const row = { id: `pa-${++seq}`, ...s.payload };
      queue.push(row);
      return { data: { id: row.id }, error: null };
    }
    if (s.op !== "select") return { data: null, error: null };
    switch (s.table) {
      case "leads": return { data: { organization_id: ORG, phone: LEAD_PHONE }, error: null };
      case "phone_ai_preferences": return { data: transferred ? prefs.after : prefs.before, error: null };
      case "pipelines": return { data: { id: PIPE_ID, slug: "vendas", is_active: true, organization_id: ORG, name: "Vendas", type: "custom" }, error: null };
      case "pipeline_stages": {
        if (s.filters.some((f) => f[0] === "in" && f[1] === "stage_key")) return { data: { stage_key: "atendimento_humano" }, error: null };
        return {
          data: [
            { id: "st-1", stage_key: "novo", position: 0, stage_role: "open" },
            { id: "st-2", stage_key: "proposta", position: 1, stage_role: "open" },
            { id: "st-3", stage_key: "pronto_para_comprar", position: 2, stage_role: "open" },
            { id: "st-4", stage_key: "atendimento_humano", position: 3, stage_role: "open" },
          ],
          error: null,
        };
      }
      case "pipeline_entries":
        if (s.single) return { data: { metadata: {} }, error: null };
        return { data: [{ id: "entry-1", organization_id: ORG, pipeline_id: PIPE_ID, stage_id: "st-2", lead_id: LEAD, stage_key: "proposta", assigned_to: null, notes: null, metadata: {}, closed_at: null }], error: null };
      default: return { data: s.single ? null : [], error: null };
    }
  }

  function builder(table: string): any {
    const s: Op = { table, op: "select", filters: [] };
    const rec = () => { if (!ops.includes(s)) ops.push(s); };
    const b: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") {
          rec();
          const r = resolve(s);
          return (ok: any, ko: any) => Promise.resolve(r).then(ok, ko);
        }
        return (...args: any[]) => {
          if (["insert", "update", "upsert", "delete"].includes(prop)) { s.op = prop; s.payload = args[0]; }
          else if (prop === "single" || prop === "maybeSingle") { s.single = true; }
          else if (["eq", "in", "neq", "is", "not", "gte", "lte", "or", "ilike", "order", "limit"].includes(prop)) s.filters.push([prop, ...args]);
          return b;
        };
      },
    });
    return b;
  }
  const client: any = {
    from: (t: string) => builder(t),
    rpc: async (fn: string, args: any) => {
      rpcs.push({ fn, args });
      if (fn === "transfer_lead_to_human") transferred = true;
      return { data: null, error: null };
    },
  };
  return { client, ops, rpcs, queue };
}

// ── Fake OpenRouter ──────────────────────────────────────────────────────────
function tc(name: string, args: Record<string, unknown>, i: number) {
  return { id: `tc-${i}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}
function makeOR(script: any[]) {
  return {
    convertTools: (t: any) => t,
    convertMessages: (m: any, sys: string) => [{ role: "system", content: sys }, ...m],
    chat: vi.fn(async () => {
      const next = script.shift() ?? { content: "ok" };
      return {
        choices: [{
          message: { role: "assistant", content: next.content ?? null, tool_calls: next.tools },
          finish_reason: next.tools ? "tool_calls" : "stop",
        }],
      };
    }),
  };
}

const ASSIST = "Perfeito! Já vou chamar o time comercial SEGREDO_ASSISTENTE.";
const USER_MSG = "Quero fechar 50 caixas de macerado de morango hoje";
const ALLOW = ["5511999990001", "5511999990002"];
const STRANGER = "5521988887777";

function baseCaps(extra: Record<string, unknown> = {}) {
  return {
    id: "agent-macerados", name: "Macerados", is_active: true, system_prompt: "x",
    can_transfer_human: true, can_qualify_lead: false,
    automation_actions: { onQualify: { kind: "q" }, onDisqualify: { kind: "d" }, onNeedHuman: { kind: "h" } },
    handoff_notify_phones: ALLOW,
    intent_detection: null,
    ...extra,
  };
}

async function run(
  script: any[],
  opts: { caps?: any; positions?: any[]; state?: string; prefs?: PrefScript } = {},
) {
  ctl.caps = opts.caps ?? baseCaps();
  ctl.lead = { id: LEAD, name: "Ana", funnel_positions: opts.positions ?? [{ pipeline_slug: "vendas", pipeline_id: PIPE_ID, stage_key: "proposta" }] };
  ctl.conv = { id: CONV, state: opts.state ?? "QUALIFYING", turn_count: 3, lead_id: LEAD };
  runtimeLogs.length = 0;
  const fake = makeFake(opts.prefs ?? { before: PREF_ENABLED, after: PREF_HANDOFF });
  const engine = new AgentEngine(fake.client, makeOR(script) as any, ORG);
  const out = await engine.processMessage(LEAD, USER_MSG);
  await new Promise((r) => setTimeout(r, 20));
  const finalState = fake.rpcs.find((r) => r.fn === "increment_conversation_turn")?.args.p_new_state;
  const types: string[] = fake.queue.map((q) => q.action_type);
  const transfers = fake.rpcs.filter((r) => r.fn === "transfer_lead_to_human");
  const humanMove = fake.ops.filter((o) => o.table === "pipeline_entries" && o.op === "update");
  const humanStageLookup = fake.ops.filter((o) => o.table === "pipeline_stages" && o.filters.some((f) => f[0] === "in"));
  const tele = runtimeLogs.find((l) => l.action === "turn_telemetry");
  const allWrites = JSON.stringify({ ops: fake.ops.filter((o) => o.op !== "select"), rpcs: fake.rpcs, queue: fake.queue, logs: runtimeLogs, out });
  const queued = (type: string) => fake.queue.filter((q) => q.action_type === type);
  return { out, fake, finalState, types, transfers, humanMove, humanStageLookup, tele, allWrites, queued };
}

const UPD = tc("update_lead", { field: "interesse", value: "50 caixas morango" }, 1);
const ADV = tc("advance_stage", { target_stage: "pronto_para_comprar", target_pipe: "vendas" }, 2);
const POLICY = { stage_handoff: { version: 1, stages: [{ stage_key: "pronto_para_comprar", pipe: "vendas" }] } };

/** Payloads das duas notificações de transferência (a WA pode não existir). */
function notifyPayloads(r: Awaited<ReturnType<typeof run>>) {
  return {
    notify: r.queued("transfer_to_human_notify")[0]?.payload,
    wa: r.queued("transfer_to_human_whatsapp_notify")[0]?.payload,
  };
}

describe("AgentEngine.processMessage — N tool_calls por turno", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("A: [update_lead, advance_stage, transfer(allow+estranho)] → 3 ações, transfer por último, número estranho barrado, sem move p/ humano", async () => {
    const TR = tc("transfer_to_human", { reason: "quer comprar", summary: "Lead quer 50 caixas", priority: "ALTA", notify_phones: [ALLOW[0], STRANGER] }, 3);
    const r = await run([{ content: ASSIST, tools: [UPD, ADV, TR] }]);
    expect(r.out.actions_executed).toEqual(["UPDATE_LEAD", "ADVANCE_STAGE", "TRANSFER_HUMAN"]);
    expect(r.types).toContain("update_lead");
    expect(r.queued("advance_stage")[0].payload).toMatchObject({ target_stage: "pronto_para_comprar", target_pipe: "vendas", lead_id: LEAD });
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0].args).toEqual({ p_lead_id: LEAD });
    const { notify, wa } = notifyPayloads(r);
    expect(wa.notify_phones).toEqual([ALLOW[0]]);
    expect(notify.notify_phones).toEqual([ALLOW[0]]);
    expect(r.allWrites).not.toContain(STRANGER);
    expect(r.humanMove).toHaveLength(0);
    expect(r.humanStageLookup).toHaveLength(0);
    expect(r.types).not.toContain("update_pipeline_stage");
    expect(r.finalState).toBe("WAITING_HUMAN");
    expect(r.types.indexOf("advance_stage")).toBeLessThan(r.types.indexOf("transfer_to_human_notify"));
    expect(r.types).toContain("automation_need_human");
    expect(r.out.message).toContain("Perfeito");
  });

  it("A-controle: só transfer_to_human (sem advance) → card É movido p/ atendimento_humano", async () => {
    const TR = tc("transfer_to_human", { reason: "x", summary: "s" }, 3);
    const r = await run([{ content: ASSIST, tools: [TR] }], { caps: baseCaps({ copilot_agent_kanban_rules: [] }) });
    expect(r.transfers).toHaveLength(1);
    expect(r.humanStageLookup.length).toBeGreaterThan(0);
    expect(r.humanMove.length).toBeGreaterThan(0);
  });

  it("B: policy + allowlist(2); LLM só [update_lead, advance_stage] → TRANSFER sintetizado ALTA, 2 números, summary sem texto do assistente", async () => {
    const r = await run([{ content: ASSIST, tools: [UPD, ADV] }], { caps: baseCaps({ intent_detection: POLICY }) });
    expect(r.out.actions_executed).toEqual(["UPDATE_LEAD", "ADVANCE_STAGE", "TRANSFER_HUMAN"]);
    expect(r.transfers).toHaveLength(1);
    const { notify, wa } = notifyPayloads(r);
    expect(wa.priority).toBe("ALTA");
    expect(wa.notify_phones).toEqual(ALLOW);
    expect(notify.notify_phones).toEqual(ALLOW);
    expect(wa.summary).toContain(USER_MSG);
    expect(wa.summary).not.toContain("SEGREDO_ASSISTENTE");
    expect(JSON.stringify(r.fake.queue.filter((q) => q.action_type.startsWith("transfer")))).not.toContain("SEGREDO_ASSISTENTE");
    expect(r.humanMove).toHaveLength(0);
    expect(r.finalState).toBe("WAITING_HUMAN");
    expect(r.tele.payloadSnapshot.tools_called).toContain("SYNTH:TRANSFER_HUMAN");
  });

  it("C: B mas lead já em pronto_para_comprar → sem síntese (anti-loop)", async () => {
    const r = await run([{ content: ASSIST, tools: [UPD, ADV] }], {
      caps: baseCaps({ intent_detection: POLICY }),
      positions: [{ pipeline_slug: "vendas", pipeline_id: PIPE_ID, stage_key: "pronto_para_comprar" }],
    });
    expect(r.out.actions_executed).toEqual(["UPDATE_LEAD", "ADVANCE_STAGE"]);
    expect(r.transfers).toHaveLength(0);
    expect(r.types.filter((t) => t.startsWith("transfer"))).toHaveLength(0);
    expect(r.finalState).toBe("QUALIFYING");
  });

  it("D: agente sem policy, só [advance_stage] → nenhuma transferência", async () => {
    const r = await run([{ content: ASSIST, tools: [ADV] }]);
    expect(r.out.actions_executed).toEqual(["ADVANCE_STAGE"]);
    expect(r.transfers).toHaveLength(0);
    expect(r.types).toEqual(["advance_stage"]);
    expect(r.finalState).toBe("QUALIFYING");
  });

  it("E: [qualify_lead, disqualify_lead] + texto → nenhum efeito de qualificação, sem fallback", async () => {
    const r = await run([{ content: ASSIST, tools: [tc("qualify_lead", { reason: "a" }, 1), tc("disqualify_lead", { reason: "b" }, 2)] }]);
    expect(r.out.actions_executed).toEqual([]);
    expect(r.types.filter((t) => t.startsWith("automation_"))).toHaveLength(0);
    expect(r.transfers).toHaveLength(0);
    expect(r.finalState).toBe("QUALIFYING");
    expect(r.tele.payloadSnapshot.fallback_used).toBe(false);
    expect(r.out.message).toContain("Perfeito");
  });

  it("F: 2× transfer_to_human → uma transferência e uma notificação", async () => {
    const r = await run([{ content: ASSIST, tools: [tc("transfer_to_human", { reason: "a", notify_phones: [ALLOW[0]] }, 1), tc("transfer_to_human", { reason: "b", notify_phones: [ALLOW[1]] }, 2)] }]);
    expect(r.transfers).toHaveLength(1);
    expect(r.queued("transfer_to_human_notify")).toHaveLength(1);
    expect(r.queued("transfer_to_human_whatsapp_notify")).toHaveLength(1);
    expect(r.out.actions_executed).toEqual(["TRANSFER_HUMAN"]);
  });

  it("G1: só texto → sem ação, sem transfer", async () => {
    const r = await run([{ content: "Oi! Temos morango e maracujá." }]);
    expect(r.out.actions_executed).toEqual([]);
    expect(r.transfers).toHaveLength(0);
    expect(r.types.filter((t) => t !== "update_pipeline_stage")).toEqual([]);
    expect(r.out.message).toBe("Oi! Temos morango e maracujá.");
    expect(r.finalState).toBe("QUALIFYING");
  });

  it("G2: só send_document → mídia enfileirada como antes, sem marcador de handoff", async () => {
    const r = await run([{ content: "Segue o catálogo", tools: [tc("send_document", { document_id: "doc-1" }, 1)] }]);
    const sd = r.queued("send_document");
    expect(sd).toHaveLength(1);
    expect(sd[0].payload).toMatchObject({ document_id: "doc-1", lead_id: LEAD });
    expect(sd[0].payload.same_turn_handoff).toBeUndefined();
    expect(r.out.actions_executed).toEqual(["SEND_DOCUMENT"]);
    expect(r.transfers).toHaveLength(0);
  });

  it("H: allowlist ausente + transfer com notify_phones do LLM → nenhum WhatsApp de notificação, payload sem notify_phones", async () => {
    const r = await run(
      [{ content: ASSIST, tools: [tc("transfer_to_human", { reason: "x", notify_phones: [STRANGER, ALLOW[0]] }, 1)] }],
      { caps: baseCaps({ handoff_notify_phones: null }) },
    );
    expect(r.transfers).toHaveLength(1);
    expect(r.types).not.toContain("transfer_to_human_whatsapp_notify");
    expect(notifyPayloads(r).notify.notify_phones).toBeUndefined();
    expect(r.allWrites).not.toContain(STRANGER);
  });

  it("extra: policy + LLM só [advance_stage] SEM allowlist → transfer sintetizado sem WhatsApp", async () => {
    const r = await run([{ content: ASSIST, tools: [ADV] }], { caps: baseCaps({ intent_detection: POLICY, handoff_notify_phones: [] }) });
    expect(r.transfers).toHaveLength(1);
    expect(r.types).not.toContain("transfer_to_human_whatsapp_notify");
    expect(notifyPayloads(r).notify.notify_phones).toBeUndefined();
  });

  it("extra: policy, advance_stage com pipe uuid (policy por slug) → sem síntese", async () => {
    const r = await run(
      [{ content: ASSIST, tools: [tc("advance_stage", { target_stage: "pronto_para_comprar", target_pipe: PIPE_ID }, 1)] }],
      { caps: baseCaps({ intent_detection: POLICY }) },
    );
    expect(r.transfers).toHaveLength(0);
  });

  it("extra: content:null + [update_lead, advance_stage] com policy → forced-text e síntese", async () => {
    const r = await run([{ content: null, tools: [UPD, ADV] }, { content: "Show, vou te passar!" }], { caps: baseCaps({ intent_detection: POLICY }) });
    expect(r.out.actions_executed).toEqual(["UPDATE_LEAD", "ADVANCE_STAGE", "TRANSFER_HUMAN"]);
    expect(r.tele.payloadSnapshot.fallback_used).toBe(false);
  });
});

describe("AgentEngine — allowlist de notify_phones no ponto de uso (executeAction)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("recuperada (sanitizer): transfer vazado em texto com número estranho → só allowlist", async () => {
    const leaked = "Vou te passar pro time.\n```json\n" +
      JSON.stringify({ action: "transfer_to_human", action_input: { reason: "x", notify_phones: [STRANGER, ALLOW[1]] } }) +
      "\n```";
    const r = await run([{ content: leaked }]);
    expect(r.transfers).toHaveLength(1);
    const { notify, wa } = notifyPayloads(r);
    expect(wa.notify_phones).toEqual([ALLOW[1]]);
    expect(notify.notify_phones).toEqual([ALLOW[1]]);
    expect(r.allWrites).not.toContain(STRANGER);
  });

  it("recuperada sem allowlist → nenhum WA notify e payload sem notify_phones", async () => {
    const leaked = "Vou te passar pro time.\n```json\n" +
      JSON.stringify({ action: "transfer_to_human", action_input: { reason: "x", notify_phones: [STRANGER] } }) +
      "\n```";
    const r = await run([{ content: leaked }], { caps: baseCaps({ handoff_notify_phones: null }) });
    expect(r.transfers).toHaveLength(1);
    expect(r.types).not.toContain("transfer_to_human_whatsapp_notify");
    expect(notifyPayloads(r).notify.notify_phones).toBeUndefined();
    expect(r.allWrites).not.toContain(STRANGER);
  });

  it("fallback (sem texto) → TRANSFER fallback notifica a allowlist inteira, WAITING_HUMAN", async () => {
    const r = await run([{ content: null }, { content: null }, { content: null }]);
    expect(r.transfers).toHaveLength(1);
    const { notify, wa } = notifyPayloads(r);
    expect(wa.notify_phones).toEqual(ALLOW);
    expect(notify.notify_phones).toEqual(ALLOW);
    expect(r.finalState).toBe("WAITING_HUMAN");
  });

  it("fallback sem allowlist → nenhum WA notify e payload sem notify_phones", async () => {
    const r = await run([{ content: null }, { content: null }, { content: null }], { caps: baseCaps({ handoff_notify_phones: [] }) });
    expect(r.transfers).toHaveLength(1);
    expect(r.types).not.toContain("transfer_to_human_whatsapp_notify");
    expect(notifyPayloads(r).notify.notify_phones).toBeUndefined();
  });

  it("allowlist com entradas inválidas → só números válidos chegam ao WA notify", async () => {
    const r = await run(
      [{ content: ASSIST, tools: [tc("transfer_to_human", { reason: "x" }, 1)] }],
      { caps: baseCaps({ handoff_notify_phones: [ALLOW[0], "", 42, null] }) },
    );
    expect(notifyPayloads(r).wa.notify_phones).toEqual([ALLOW[0]]);
  });
});

describe("AgentEngine — mídia × handoff do MESMO turno", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const SEND = tc("send_document", { document_id: "doc-1", caption: "catálogo" }, 1);
  const TRANSFER = tc("transfer_to_human", { reason: "quer comprar" }, 2);

  it("[send_document, transfer] → transfer antes, mídia leva o carimbo do desligamento causado pelo turno", async () => {
    const r = await run([{ content: ASSIST, tools: [SEND, TRANSFER] }]);
    expect(r.out.actions_executed).toEqual(["TRANSFER_HUMAN", "SEND_DOCUMENT"]);
    expect(r.transfers).toHaveLength(1);
    const sd = r.queued("send_document");
    expect(sd).toHaveLength(1);
    expect(sd[0].payload.same_turn_handoff).toEqual({ lead_id: LEAD, disabled_at: DISABLED_AT });
  });

  it("IA já desligada ANTES do turno (humano) → sem marcador: o worker segue cancelando", async () => {
    const humanOff: Pref = { ai_disabled: true, human_paused_until: null, set_by: "user-1", set_at: "2026-10-13T11:00:00+00:00" };
    const r = await run([{ content: ASSIST, tools: [SEND, TRANSFER] }], { prefs: { before: humanOff, after: humanOff } });
    expect(r.queued("send_document")[0].payload.same_turn_handoff).toBeUndefined();
  });

  it("pausa humana ativa antes do turno → sem marcador", async () => {
    const paused: Pref = { ...PREF_ENABLED!, human_paused_until: "2999-01-01T00:00:00+00:00" };
    const r = await run([{ content: ASSIST, tools: [SEND, TRANSFER] }], { prefs: { before: paused, after: { ...PREF_HANDOFF!, human_paused_until: "2999-01-01T00:00:00+00:00" } } });
    expect(r.queued("send_document")[0].payload.same_turn_handoff).toBeUndefined();
  });

  it("LLM injeta same_turn_handoff nos params (sem transfer) → descartado", async () => {
    const forged = tc("send_document", { document_id: "doc-1", same_turn_handoff: { lead_id: LEAD, disabled_at: DISABLED_AT } }, 1);
    const r = await run([{ content: "Segue", tools: [forged] }]);
    expect(r.queued("send_document")[0].payload.same_turn_handoff).toBeUndefined();
  });

  it("LLM injeta marcador forjado E transfere → vale o carimbo real lido pelo engine, nunca o do LLM", async () => {
    const forged = tc("send_document", { document_id: "doc-1", same_turn_handoff: { lead_id: "outro", disabled_at: "2000-01-01T00:00:00Z" } }, 1);
    const r = await run([{ content: ASSIST, tools: [forged, TRANSFER] }]);
    expect(r.queued("send_document")[0].payload.same_turn_handoff).toEqual({ lead_id: LEAD, disabled_at: DISABLED_AT });
  });

  it("turno sem mídia → transferência não paga as leituras extras do gate", async () => {
    const r = await run([{ content: ASSIST, tools: [TRANSFER] }]);
    expect(r.fake.ops.filter((o) => o.table === "phone_ai_preferences")).toHaveLength(0);
  });
});

describe("AgentEngine — automação de estado × ADVANCE_STAGE do mesmo turno", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const AUTOMATION = {
    onQualify: { moveToStage: "qualificado" },
    onDisqualify: { moveToStage: "perdido" },
    onNeedHuman: { moveToStage: "atendimento_humano" },
  };

  it("policy: [advance_stage] + transfer sintetizado, onNeedHuman.moveToStage → automation_need_human com skip_stage_move", async () => {
    const r = await run([{ content: ASSIST, tools: [ADV] }], { caps: baseCaps({ intent_detection: POLICY, automation_actions: AUTOMATION }) });
    expect(r.out.actions_executed).toEqual(["ADVANCE_STAGE", "TRANSFER_HUMAN"]);
    const auto = r.queued("automation_need_human");
    expect(auto).toHaveLength(1);
    expect(auto[0].payload).toMatchObject({ action_type: "need_human", skip_stage_move: true });
  });

  it("[qualify_lead, advance_stage], onQualify.moveToStage → automation_qualify com skip_stage_move", async () => {
    const r = await run(
      [{ content: ASSIST, tools: [tc("qualify_lead", { reason: "fit" }, 1), ADV] }],
      { caps: baseCaps({ automation_actions: AUTOMATION }) },
    );
    const auto = r.queued("automation_qualify");
    expect(auto).toHaveLength(1);
    expect(auto[0].payload).toMatchObject({ action_type: "qualify", skip_stage_move: true });
  });

  it("controle: transfer sem advance → automation_need_human SEM skip_stage_move (configuração vale)", async () => {
    const r = await run([{ content: ASSIST, tools: [tc("transfer_to_human", { reason: "x" }, 1)] }], { caps: baseCaps({ automation_actions: AUTOMATION }) });
    const auto = r.queued("automation_need_human");
    expect(auto).toHaveLength(1);
    expect(auto[0].payload.skip_stage_move).toBeUndefined();
  });

  it("controle: qualify sem advance → automation_qualify SEM skip_stage_move", async () => {
    const r = await run([{ content: ASSIST, tools: [tc("qualify_lead", { reason: "fit" }, 1)] }], { caps: baseCaps({ automation_actions: AUTOMATION }) });
    const auto = r.queued("automation_qualify");
    expect(auto).toHaveLength(1);
    expect(auto[0].payload.skip_stage_move).toBeUndefined();
  });
});
