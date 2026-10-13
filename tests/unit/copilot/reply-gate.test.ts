/**
 * H1 (2026-10-13): o texto do turno de transferência era descartado pelo gate
 * pós-LLM e pelos gates por chunk — a IA estava desligada pelo PRÓPRIO turno.
 *
 * Cobre:
 *  - decisão pura do pós-LLM (agent-message/post-llm-gate.ts): libera só com o
 *    carimbo idêntico; cancela sem carimbo / set_at diferente / pausa humana /
 *    outro lead / fonte error|default / humano manual;
 *  - absorb loop não roda após handoff ou cancelamento;
 *  - resposta pública leva lead_id + same_turn_handoff, sem _eval_meta;
 *  - gate por chunk compartilhado (checkReplyGate) com gate real
 *    (isCopilotCanceled) sobre dublê do banco, para CADA um dos 4 chamadores;
 *  - fiação: cada chamador usa checkReplyGate com o turno da resposta, e não
 *    sobrou isCopilotCanceled cru no laço de chunks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";

const runtimeLogs: Array<Record<string, unknown>> = [];
vi.mock("../../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn(async (e: Record<string, unknown>) => { runtimeLogs.push(e); }),
  redactSecrets: (v: unknown) => v,
}));

import type { CancellationCheck } from "../../../supabase/functions/_shared/copilot/cancellation.ts";
import {
  checkReplyGate,
  decideReplyGate,
  replyTurnFromAgentResponse,
  type ReplyGateName,
} from "../../../supabase/functions/_shared/copilot/reply-gate.ts";
import {
  buildPublicResponse,
  decidePostLlmGate,
  shouldRunAbsorbLoop,
} from "../../../supabase/functions/agent-message/post-llm-gate.ts";

const ORG = "00000000-0000-0000-0000-000000000001";
const NORMALIZED = "11987654321";
const PHONE = "+55 11 98765-4321";
const LEAD = "lead-123";
const DISABLED_AT = "2026-10-13T12:00:00.123456+00:00";
const MARKER = { lead_id: LEAD, disabled_at: DISABLED_AT };

const HANDOFF: CancellationCheck = {
  canceled: true, ai_disabled: true, source: "phone_ai_preferences", systemDisabled: false,
  disabledAt: DISABLED_AT, humanPauseActive: false,
};

beforeEach(() => { runtimeLogs.length = 0; });

describe("decidePostLlmGate (agent-message pós-LLM)", () => {
  const resp = (m: unknown) => ({ message: "Já vou te passar para o time", same_turn_handoff: m });

  it("IA ligada → deliver", () => {
    expect(decidePostLlmGate({ canceled: false, ai_disabled: false, source: "phone_ai_preferences", systemDisabled: false }, resp(null), LEAD)).toBe("deliver");
  });

  it("cancelado pelo handoff do turno (carimbo idêntico) → release", () => {
    expect(decidePostLlmGate(HANDOFF, resp(MARKER), LEAD)).toBe("release");
  });

  it("mesmo instante em outra notação → release", () => {
    expect(decidePostLlmGate({ ...HANDOFF, disabledAt: "2026-10-13T12:00:00.123456Z" }, resp(MARKER), LEAD)).toBe("release");
  });

  it("fallback leads com carimbo idêntico → release", () => {
    expect(decidePostLlmGate({ ...HANDOFF, source: "leads" }, resp(MARKER), LEAD)).toBe("release");
  });

  const cancels: Array<[string, CancellationCheck, unknown, string]> = [
    ["sem carimbo (controle)", HANDOFF, null, LEAD],
    ["set_at diferente (humano desligou de novo)", { ...HANDOFF, disabledAt: "2026-10-13T12:00:05+00:00" }, MARKER, LEAD],
    ["pausa humana ativa junto", { ...HANDOFF, humanPauseActive: true }, MARKER, LEAD],
    ["só pausa humana", { canceled: true, ai_disabled: false, source: "human_pause", systemDisabled: false, humanPauseActive: true }, MARKER, LEAD],
    ["carimbo de outro lead", HANDOFF, { ...MARKER, lead_id: "lead-999" }, LEAD],
    ["fonte error", { ...HANDOFF, source: "error" }, MARKER, LEAD],
    ["fonte default", { ...HANDOFF, source: "default" }, MARKER, LEAD],
    ["humano manual (set_by) com outro carimbo", { ...HANDOFF, disabledAt: "2026-10-13T11:00:00+00:00" }, MARKER, LEAD],
    ["carimbo malformado", HANDOFF, { lead_id: LEAD, disabled_at: "nope" }, LEAD],
    ["disabledAt ilegível no gate", { ...HANDOFF, disabledAt: null }, MARKER, LEAD],
  ];
  for (const [name, check, marker, lead] of cancels) {
    it(`${name} → cancel`, () => {
      expect(decidePostLlmGate(check, resp(marker), lead)).toBe("cancel");
    });
  }
});

describe("shouldRunAbsorbLoop", () => {
  it("roda só sem carimbo e com entrega normal", () => {
    expect(shouldRunAbsorbLoop("deliver", { same_turn_handoff: null })).toBe(true);
    expect(shouldRunAbsorbLoop("deliver", {})).toBe(true);
  });
  it("não roda após handoff (release, ou carimbo presente mesmo com IA religada)", () => {
    expect(shouldRunAbsorbLoop("release", { same_turn_handoff: MARKER })).toBe(false);
    expect(shouldRunAbsorbLoop("deliver", { same_turn_handoff: MARKER })).toBe(false);
  });
  it("não roda após cancelamento", () => {
    expect(shouldRunAbsorbLoop("cancel", {})).toBe(false);
  });
});

describe("buildPublicResponse", () => {
  it("inclui lead_id e same_turn_handoff; remove _eval_meta", () => {
    const pub = buildPublicResponse({ message: "x", same_turn_handoff: MARKER, _eval_meta: { conversationId: "c" } }, LEAD);
    expect(pub).toEqual({ message: "x", lead_id: LEAD, same_turn_handoff: MARKER });
  });
  it("sem carimbo → same_turn_handoff null", () => {
    expect(buildPublicResponse({ message: "x" }, LEAD)).toEqual({ message: "x", lead_id: LEAD, same_turn_handoff: null });
  });
  it("round-trip: o chamador reconstrói o turno da resposta pública", () => {
    const turn = replyTurnFromAgentResponse(buildPublicResponse({ message: "x", same_turn_handoff: MARKER }, LEAD));
    expect(decideReplyGate(HANDOFF, turn)).toBe("release");
  });
});

describe("replyTurnFromAgentResponse", () => {
  it("resposta sem lead_id (versão antiga do agent-message) → não libera", () => {
    const turn = replyTurnFromAgentResponse({ message: "x", same_turn_handoff: MARKER });
    expect(turn.leadId).toBeNull();
    expect(decideReplyGate(HANDOFF, turn)).toBe("cancel");
  });
  it("payload não-objeto → turno vazio", () => {
    expect(replyTurnFromAgentResponse(null)).toEqual({ leadId: null, sameTurnHandoff: null });
    expect(replyTurnFromAgentResponse("x")).toEqual({ leadId: null, sameTurnHandoff: null });
  });
});

// ── Gate por chunk: gate real sobre dublê do banco, por chamador ─────────────
const CHUNK_GATES: ReplyGateName[] = ["outbound_chunks", "batch_chunks", "recover_chunks", "sz_chat_chunks"];

type PrefRow = Record<string, unknown>;
function db(pref: PrefRow | null, lead: PrefRow | null = null) {
  const { sb, mockTable } = createMockSupabase();
  mockTable("phone_ai_preferences", pref ? [{ organization_id: ORG, normalized_phone: NORMALIZED, ...pref }] : []);
  mockTable("leads", lead ? [{ organization_id: ORG, normalized_phone: NORMALIZED, created_at: "2026-01-01T00:00:00Z", ...lead }] : []);
  return sb;
}
const HANDOFF_PREF = { ai_disabled: true, set_by: null, set_at: DISABLED_AT, human_paused_until: null, disabled_reason: "handoff" };
const TURN = { leadId: LEAD, sameTurnHandoff: MARKER };

for (const gate of CHUNK_GATES) {
  describe(`checkReplyGate — ${gate}`, () => {
    it("handoff do próprio turno → release + log copilot_handoff_reply_released", async () => {
      const r = await checkReplyGate(db(HANDOFF_PREF), { organizationId: ORG, phone: PHONE, turn: TURN, gate });
      expect(r.decision).toBe("release");
      await Promise.resolve();
      const log = runtimeLogs.find((l) => l.action === "copilot_handoff_reply_released");
      expect(log).toMatchObject({ entityId: LEAD, payloadSnapshot: { gate } });
    });

    it("IA ligada → deliver, sem log de liberação", async () => {
      const r = await checkReplyGate(db({ ...HANDOFF_PREF, ai_disabled: false }), { organizationId: ORG, phone: PHONE, turn: { leadId: LEAD, sameTurnHandoff: null }, gate });
      expect(r.decision).toBe("deliver");
      expect(runtimeLogs).toHaveLength(0);
    });

    const cases: Array<[string, PrefRow | null, PrefRow | null, typeof TURN | { leadId: string | null; sameTurnHandoff: unknown }]> = [
      ["sem carimbo", HANDOFF_PREF, null, { leadId: LEAD, sameTurnHandoff: null }],
      ["set_at diferente", { ...HANDOFF_PREF, set_by: "user-1", set_at: "2026-10-13T12:05:00+00:00" }, null, TURN],
      ["pausa humana", { ...HANDOFF_PREF, human_paused_until: "2999-01-01T00:00:00+00:00" }, null, TURN],
      ["só pausa humana", { ...HANDOFF_PREF, ai_disabled: false, human_paused_until: "2999-01-01T00:00:00+00:00" }, null, TURN],
      ["outro lead", HANDOFF_PREF, null, { leadId: "lead-999", sameTurnHandoff: MARKER }],
    ];
    for (const [name, pref, lead, turn] of cases) {
      it(`${name} → cancel`, async () => {
        const r = await checkReplyGate(db(pref, lead), { organizationId: ORG, phone: PHONE, turn, gate });
        expect(r.decision).toBe("cancel");
        expect(runtimeLogs.filter((l) => l.action === "copilot_handoff_reply_released")).toHaveLength(0);
      });
    }

    it("fonte error (exceção no banco) → não cancela por erro, mas nunca 'release'", async () => {
      const sb = { from: () => { throw new Error("boom"); } } as unknown as Parameters<typeof checkReplyGate>[0];
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const r = await checkReplyGate(sb, { organizationId: ORG, phone: PHONE, turn: TURN, gate });
      expect(r.check.source).toBe("error");
      expect(r.decision).not.toBe("release");
    });

    it("fonte default (telefone inválido) → nunca 'release'", async () => {
      const r = await checkReplyGate(db(HANDOFF_PREF), { organizationId: ORG, phone: "abc", turn: TURN, gate });
      expect(r.check.source).toBe("default");
      expect(r.decision).toBe("deliver");
    });
  });
}

// ── Fiação: os 4 chamadores usam o gate compartilhado com o turno da resposta ─
const read = (p: string) => readFileSync(resolve(process.cwd(), "supabase/functions", p), "utf8");
const CALLERS: Array<[string, ReplyGateName, RegExp]> = [
  ["whatsapp-webhook/handler.ts", "outbound_chunks", /replyTurnFromAgentResponse\(agentData\)/],
  ["copilot-batch-processor/index.ts", "batch_chunks", /replyTurnFromAgentResponse\(data\)/],
  ["recover-stuck-conversations/index.ts", "recover_chunks", /replyTurnFromAgentResponse\(agentData\)/],
  ["sz-chat-webhook/index.ts", "sz_chat_chunks", /replyTurnFromAgentResponse\(result\)/],
];
describe("fiação dos gates por chunk", () => {
  for (const [file, gate, turnFrom] of CALLERS) {
    it(`${file}: checkReplyGate("${gate}") com o turno da resposta, decisão 'cancel' interrompe`, () => {
      const src = read(file);
      expect(src).toMatch(turnFrom);
      expect(src).toMatch(new RegExp(`checkReplyGate\\(supabase, \\{[^}]*turn: replyTurn[^}]*gate: "${gate}"`));
      expect(src).toMatch(/decision === "cancel"/);
    });
  }

  it("nenhum laço de chunk chama isCopilotCanceled direto", () => {
    expect(read("whatsapp-webhook/handler.ts")).not.toMatch(/isCopilotCanceled/);
    expect(read("copilot-batch-processor/index.ts").match(/isCopilotCanceled\(/g)).toHaveLength(1); // só o pré-gate
    expect(read("recover-stuck-conversations/index.ts").match(/isCopilotCanceled\(/g)).toHaveLength(1); // só o pré-gate
    const sz = read("sz-chat-webhook/index.ts");
    const send = sz.slice(sz.indexOf("async function sendSzChatResponse"), sz.indexOf("// ─── Event Handlers"));
    expect(send).not.toMatch(/isCopilotCanceled/);
    expect(sz).toMatch(/agentResult\.replyTurn,/);
  });

  it("agent-message: decisão pós-LLM, absorb e resposta pública vêm do módulo puro", () => {
    const src = read("agent-message/index.ts");
    expect(src).toMatch(/decidePostLlmGate\(cancelCheck, response, lead\.id\)/);
    expect(src).toMatch(/if \(postLlmDecision === "cancel"\)/);
    expect(src).toMatch(/if \(shouldRunAbsorbLoop\(postLlmDecision, response\)\)/);
    expect(src).toMatch(/buildPublicResponse\(response as Record<string, unknown>, lead\.id\)/);
  });
});
