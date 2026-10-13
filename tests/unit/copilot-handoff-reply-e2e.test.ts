// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- dublês de Supabase/OpenRouter: forma estrutural, não tipada */
/**
 * H1 ponta a ponta (2026-10-13): o texto do turno de transferência chega ao
 * lead. Encadeia as peças reais na ordem de produção:
 *
 *   AgentEngine.processMessage (transferência inline → carimbo)
 *   → gate pós-LLM do agent-message (decidePostLlmGate + isCopilotCanceled)
 *   → resposta pública (buildPublicResponse, round-trip JSON)
 *   → gate por chunk do chamador (checkReplyGate, por parte)
 *   → worker de mídia (executeSendDocument) com o payload enfileirado.
 *
 * Dublês: banco (preferência muda quando o RPC transfer_lead_to_human roda),
 * OpenRouter (roteiro) e provider WhatsApp. Harness derivado de
 * agent-engine-multi-tool.test.ts.
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

const ctl: { caps: any; lead: any; conv: any; fake?: any } = { caps: null, lead: null, conv: null };
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

vi.mock("../../supabase/functions/_shared/whatsapp-dispatch.ts", () => ({
  resolveDispatchContext: vi.fn(),
  DispatchResolutionError: class extends Error {},
}));
vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_n: string, fn: unknown) => fn,
  logError: vi.fn(async () => {}),
  logEvent: vi.fn(async () => {}),
}));

const { AgentEngine } = await import("../../supabase/functions/agent-message/agent-engine.ts");
const { isCopilotCanceled } = await import("../../supabase/functions/_shared/copilot/cancellation.ts");
const { checkReplyGate, replyTurnFromAgentResponse } = await import("../../supabase/functions/_shared/copilot/reply-gate.ts");
const { buildPublicResponse, decidePostLlmGate, shouldRunAbsorbLoop } = await import("../../supabase/functions/agent-message/post-llm-gate.ts");
const { executeSendDocument } = await import("../../supabase/functions/_shared/actions/send-document.ts");
const { resolveDispatchContext } = await import("../../supabase/functions/_shared/whatsapp-dispatch.ts");

// ── Fake Supabase ────────────────────────────────────────────────────────────
const ORG = "org-macerados";
const LEAD = "lead-1111";
const CONV = "conv-2222";
const PIPE_ID = "11111111-2222-3333-4444-555555555555";
const LEAD_PHONE = "+55 11 98888-0000";
const DISABLED_AT = "2026-10-13T12:00:00.123456+00:00";

type Pref = { ai_disabled: boolean; human_paused_until: string | null; set_by: string | null; set_at: string; disabled_reason?: string | null } | null;
type PrefScript = { before: Pref; after: Pref };
const PREF_ENABLED: Pref = { ai_disabled: false, human_paused_until: null, set_by: null, set_at: "2026-01-01T00:00:00+00:00" };
const PREF_HANDOFF: Pref = { ai_disabled: true, human_paused_until: null, set_by: null, set_at: DISABLED_AT, disabled_reason: "handoff" };

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
  return { client, ops, rpcs, queue, prefs };
}

const ASSIST = "Perfeito! Já vou te passar para o nosso time comercial.";
const USER_MSG = "Quero falar com um vendedor";

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

const ALLOW = ["5511999990001", "5511999990002"];

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
  ctl.fake = fake;
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



function sendDocSupabase(pref: Pref) {
  const sendMedia = vi.fn(async () => ({ message_id: "m-1" }));
  const tb = (resolved: { data: any; error: any }) => {
    const b: any = {};
    for (const m of ["select", "eq", "in", "neq", "ilike", "gte", "limit", "order", "single", "maybeSingle", "delete", "upsert", "insert", "update"]) b[m] = vi.fn(() => b);
    b.then = (resolve: any) => resolve(resolved);
    return b;
  };
  const supabase: any = {
    rpc: vi.fn(async (name: string) => name === "copilot_v2_acquire_dedup_lock" ? { data: true, error: null } : { data: null, error: null }),
    from: vi.fn((table: string) => {
      switch (table) {
        case "copilot_agent_documents":
          return tb({ data: { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", file_name: "catalogo.pdf", file_path: "o/a/catalogo.pdf", mime_type: "application/pdf", organization_id: ORG, file_type: "document" }, error: null });
        case "phone_ai_preferences": return tb({ data: pref, error: null });
        case "leads": return tb({ data: { phone: LEAD_PHONE }, error: null });
        case "conversations": return tb({ data: { agent_id: "agent-y" }, error: null });
        default: return tb({ data: null, error: null });
      }
    }),
    storage: { from: vi.fn(() => ({ createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://store/sign/x.pdf?token=t" }, error: null })) })) },
  };
  (resolveDispatchContext as any).mockResolvedValue({ provider: { sendMedia }, instance: { id: "inst-1" }, normalizedPhone: "5511988880000" });
  return { supabase, sendMedia };
}

/**
 * Turno completo. `afterTurn` simula o que acontece ENTRE o turno e a entrega
 * (ex.: humano desliga de novo) trocando a preferência vista pelos gates.
 */
async function deliverTurn(script: any[], opts: { prefs?: PrefScript; afterTurn?: Pref } = {}) {
  const r = await run(script, { prefs: opts.prefs });
  const fake = ctl.fake;
  if (opts.afterTurn !== undefined) fake.prefs.after = opts.afterTurn;

  // agent-message: gate pós-LLM
  const check = await isCopilotCanceled(fake.client, ORG, LEAD_PHONE);
  const decision = decidePostLlmGate(check, r.out, LEAD);
  const absorb = shouldRunAbsorbLoop(decision, r.out);
  if (decision === "cancel") return { r, decision, absorb, delivered: [] as string[], pdf: null as any };

  // resposta pública atravessa o HTTP
  const pub = JSON.parse(JSON.stringify(buildPublicResponse(r.out as any, LEAD)));
  const parts: string[] = pub.messages ?? (pub.message ? [pub.message] : []);
  const turn = replyTurnFromAgentResponse(pub);
  const delivered: string[] = [];
  for (const part of parts) {
    const g = await checkReplyGate(fake.client, { organizationId: ORG, phone: LEAD_PHONE, turn, gate: "outbound_chunks" });
    if (g.decision === "cancel") break;
    delivered.push(part);
  }

  // worker de mídia com o payload enfileirado pelo turno
  let pdf: { success: boolean; sendMedia: any } | null = null;
  const sd = r.queued("send_document")[0];
  if (sd) {
    const { supabase, sendMedia } = sendDocSupabase(fake.prefs.after);
    const res = await executeSendDocument(supabase, sd.payload, ORG, LEAD, CONV, sd.id);
    pdf = { success: res.success, sendMedia };
  }
  return { r, decision, absorb, delivered, pdf };
}

const TRANSFER = tc("transfer_to_human", { reason: "quer vendedor" }, 2);
const SEND = tc("send_document", { document_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", caption: "catálogo" }, 1);

describe("H1 ponta a ponta — texto do turno de transferência chega ao lead", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("[transfer_to_human] → gate pós-LLM libera, texto entregue, absorb não roda, log de liberação", async () => {
    const t = await deliverTurn([{ content: ASSIST, tools: [TRANSFER] }]);
    expect(t.r.transfers).toHaveLength(1);
    expect(t.decision).toBe("release");
    expect(t.absorb).toBe(false);
    expect(t.delivered.join(" ")).toContain("time comercial");
    expect(runtimeLogs.some((l) => l.action === "copilot_handoff_reply_released" && l.payloadSnapshot?.gate === "outbound_chunks")).toBe(true);
  });

  it("[send_document, transfer_to_human] → texto E PDF entregues", async () => {
    const t = await deliverTurn([{ content: ASSIST, tools: [SEND, TRANSFER] }]);
    expect(t.decision).toBe("release");
    expect(t.delivered.join(" ")).toContain("time comercial");
    expect(t.pdf?.success).toBe(true);
    expect(t.pdf?.sendMedia).toHaveBeenCalledTimes(1);
  });

  it("controle: humano desliga de novo depois do turno (carimbo muda) → nada sai", async () => {
    const later: Pref = { ai_disabled: true, human_paused_until: null, set_by: "user-1", set_at: "2026-10-13T12:05:00+00:00", disabled_reason: null };
    const t = await deliverTurn([{ content: ASSIST, tools: [SEND, TRANSFER] }], { afterTurn: later });
    expect(t.decision).toBe("cancel");
    expect(t.delivered).toEqual([]);
  });

  it("controle: pausa humana ativa depois do turno → nada sai", async () => {
    const paused: Pref = { ...PREF_HANDOFF!, human_paused_until: "2999-01-01T00:00:00+00:00" };
    const t = await deliverTurn([{ content: ASSIST, tools: [TRANSFER] }], { afterTurn: paused });
    expect(t.decision).toBe("cancel");
  });

  it("controle: IA já desligada antes do turno (humano) → sem carimbo → cancela", async () => {
    const humanOff: Pref = { ai_disabled: true, human_paused_until: null, set_by: "user-1", set_at: "2026-10-13T11:00:00+00:00", disabled_reason: null };
    const t = await deliverTurn([{ content: ASSIST, tools: [TRANSFER] }], { prefs: { before: humanOff, after: humanOff } });
    expect(t.decision).toBe("cancel");
  });

  it("controle: turno sem transferência → entrega normal e absorb roda", async () => {
    const t = await deliverTurn([{ content: "Oi! Como posso ajudar?" }]);
    expect(t.decision).toBe("deliver");
    expect(t.absorb).toBe(true);
    expect(t.delivered).toEqual(["Oi! Como posso ajudar?"]);
  });
});
