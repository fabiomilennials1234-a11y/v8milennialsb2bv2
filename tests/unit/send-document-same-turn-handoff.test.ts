/* eslint-disable @typescript-eslint/no-explicit-any -- dublês de Supabase/OpenRouter: forma estrutural, não tipada */
/**
 * send-document × handoff do MESMO turno.
 *
 * Turno [send_document, transfer_to_human]: a transferência roda inline e
 * desliga a IA (RPC → leads.ai_disabled → trigger → phone_ai_preferences); a
 * mídia vai para a fila e o worker a cancelava em silêncio. O engine agora põe
 * no payload o carimbo do desligamento que o turno causou; o worker entrega SÓ
 * se o desligamento vigente é aquele. Gate real (isCopilotCanceled) + predicado
 * real (same-turn-handoff) — dublê apenas do banco e do provider.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubGlobal("Deno", {
  env: { get: () => undefined, toObject: () => ({}) },
  serve: () => {},
});

vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_n: string, fn: unknown) => fn,
  logError: vi.fn(async () => {}),
  logEvent: vi.fn(async () => {}),
}));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn(async () => {}),
  redactSecrets: (v: unknown) => v,
}));
vi.mock("../../supabase/functions/_shared/whatsapp-dispatch.ts", () => ({
  resolveDispatchContext: vi.fn(),
  DispatchResolutionError: class extends Error {},
}));

import { executeSendDocument } from "../../supabase/functions/_shared/actions/send-document.ts";
import { resolveDispatchContext } from "../../supabase/functions/_shared/whatsapp-dispatch.ts";

const ORG = "org-111";
const LEAD = "lead-123";
const DOC = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const DISABLED_AT = "2026-10-13T12:00:00.123456+00:00";

function tableBuilder(resolved: { data: any; error: any }) {
  const b: any = {};
  for (const m of ["select", "eq", "in", "neq", "ilike", "gte", "limit", "order", "single", "maybeSingle", "delete", "upsert", "insert", "update"]) {
    b[m] = vi.fn(() => b);
  }
  b.then = (resolve: any) => resolve(resolved);
  return b;
}

type Pref = Record<string, unknown> | null;

function buildSupabase(pref: Pref, leadRow: Record<string, unknown> | null = null) {
  const sendMedia = vi.fn(async () => ({ message_id: "m-1" }));
  const supabase: any = {
    rpc: vi.fn(async (name: string) =>
      name === "copilot_v2_acquire_dedup_lock" ? { data: true, error: null } : { data: null, error: null }),
    from: vi.fn((table: string) => {
      switch (table) {
        case "copilot_agent_documents":
          return tableBuilder({
            data: { id: DOC, file_name: "catalogo.pdf", file_path: "o/a/catalogo.pdf", mime_type: "application/pdf", organization_id: ORG, file_type: "document" },
            error: null,
          });
        case "phone_ai_preferences":
          return tableBuilder({ data: pref, error: null });
        case "leads":
          // send-document lê `phone`; o fallback do gate lê ai_disabled/_at.
          return tableBuilder({ data: { phone: "+5511988880000", ...(leadRow ?? {}) }, error: null });
        case "conversations":
          return tableBuilder({ data: { agent_id: "agent-y" }, error: null });
        default:
          return tableBuilder({ data: null, error: null });
      }
    }),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://store/sign/x.pdf?token=t" }, error: null })),
      })),
    },
  };
  (resolveDispatchContext as any).mockResolvedValue({
    provider: { sendMedia },
    instance: { id: "inst-1" },
    normalizedPhone: "5511988880000",
  });
  return { supabase, sendMedia };
}

const HANDOFF_PREF = { ai_disabled: true, human_paused_until: null, set_by: null, set_at: DISABLED_AT };
const MARKER = { lead_id: LEAD, disabled_at: DISABLED_AT };

async function send(pref: Pref, payloadExtra: Record<string, unknown> = {}, leadRow: Record<string, unknown> | null = null) {
  const { supabase, sendMedia } = buildSupabase(pref, leadRow);
  const result = await executeSendDocument(
    supabase, { document_id: DOC, lead_id: LEAD, ...payloadExtra }, ORG, LEAD, "conv-aaa", "action-1",
  );
  return { result, sendMedia };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("executeSendDocument — handoff do mesmo turno", () => {
  it("IA desligada pelo handoff do turno + marcador idêntico → documento É entregue", async () => {
    const { result, sendMedia } = await send(HANDOFF_PREF, { same_turn_handoff: MARKER });
    expect(result.success).toBe(true);
    expect(sendMedia).toHaveBeenCalledTimes(1);
  });

  it("controle: IA desligada e SEM marcador → cancelado (comportamento anterior)", async () => {
    const { result, sendMedia } = await send(HANDOFF_PREF);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Copilot disabled");
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it("humano desligou de novo DEPOIS do turno (carimbo mudou) → cancelado", async () => {
    const later = { ...HANDOFF_PREF, set_by: "user-1", set_at: "2026-10-13T12:05:00+00:00" };
    const { sendMedia } = await send(later, { same_turn_handoff: MARKER });
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it("pausa humana ativa junto do desligamento → cancelado mesmo com marcador", async () => {
    const paused = { ...HANDOFF_PREF, human_paused_until: "2999-01-01T00:00:00+00:00" };
    const { sendMedia } = await send(paused, { same_turn_handoff: MARKER });
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it("pausa humana sem ai_disabled → cancelado mesmo com marcador", async () => {
    const pausedOnly = { ai_disabled: false, human_paused_until: "2999-01-01T00:00:00+00:00", set_by: null, set_at: DISABLED_AT };
    const { sendMedia } = await send(pausedOnly, { same_turn_handoff: MARKER });
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it("marcador de OUTRO lead → cancelado", async () => {
    const { sendMedia } = await send(HANDOFF_PREF, { same_turn_handoff: { lead_id: "lead-999", disabled_at: DISABLED_AT } });
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it("marcador malformado → cancelado", async () => {
    for (const bad of [true, "x", { lead_id: LEAD }, { lead_id: LEAD, disabled_at: "nope" }, [MARKER]]) {
      const { sendMedia } = await send(HANDOFF_PREF, { same_turn_handoff: bad });
      expect(sendMedia).not.toHaveBeenCalled();
    }
  });

  it("fallback leads.ai_disabled (sem preference) com carimbo idêntico → entregue", async () => {
    const { sendMedia } = await send(null, { same_turn_handoff: MARKER }, { ai_disabled: true, ai_disabled_at: DISABLED_AT });
    expect(sendMedia).toHaveBeenCalledTimes(1);
  });

  it("IA ligada → entregue com ou sem marcador", async () => {
    const enabled = { ai_disabled: false, human_paused_until: null, set_by: null, set_at: DISABLED_AT };
    expect((await send(enabled)).sendMedia).toHaveBeenCalledTimes(1);
    expect((await send(enabled, { same_turn_handoff: MARKER })).sendMedia).toHaveBeenCalledTimes(1);
  });
});
