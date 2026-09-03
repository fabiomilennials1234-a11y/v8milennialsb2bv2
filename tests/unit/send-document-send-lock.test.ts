/**
 * send-document — atomic send lock + Layer-2 URL-encoding fix.
 *
 * Regression for the 2026-06-02 "Barulinho Bom" incident: the same product
 * video ("Linha de produtos.mp4") was delivered to a lead 3×.
 *
 * Root cause: process-ai-actions kills the action at 30s (ACTION_TIMEOUT_MS)
 * but does NOT abort the in-flight provider.sendMedia — the send completes,
 * the action is marked failed, the cron re-claims and re-sends. The dedup
 * safety net failed because the whatsapp_messages fallback matched the RAW
 * basename (literal spaces) against a URL-ENCODED signed URL (%20).
 *
 * Fixes under test:
 *   1. Atomic per-(conversation, document) lock via copilot_v2_acquire_dedup_lock
 *      → at-most-once delivery; retries/orphans become no-ops.
 *   2. Layer-2 fallback now matches the URL-encoded basename.
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
vi.mock("../../supabase/functions/_shared/copilot/cancellation.ts", () => ({
  isCopilotCanceled: vi.fn(async () => ({ canceled: false })),
  logCopilotCancellation: vi.fn(),
}));
vi.mock("../../supabase/functions/_shared/whatsapp-dispatch.ts", () => ({
  resolveDispatchContext: vi.fn(),
  DispatchResolutionError: class extends Error {},
}));

import {
  checkDocumentAlreadySent,
  executeSendDocument,
} from "../../supabase/functions/_shared/actions/send-document.ts";
import { resolveDispatchContext } from "../../supabase/functions/_shared/whatsapp-dispatch.ts";

/* ------------------------------------------------------------------ */
/* Mock builder                                                        */
/* ------------------------------------------------------------------ */

/** Thenable PostgREST builder that resolves a configured value and records
 *  the arguments passed to terminal/filter methods. */
function tableBuilder(resolved: { data: any; error: any }, calls: Record<string, any[]> = {}) {
  const builder: any = {};
  for (const m of ["select", "eq", "in", "neq", "ilike", "gte", "limit", "single", "maybeSingle", "delete", "upsert"]) {
    builder[m] = vi.fn((...args: any[]) => {
      (calls[m] ||= []).push(args);
      return builder;
    });
  }
  builder.then = (resolve: any) => resolve(resolved);
  builder._calls = calls;
  return builder;
}

interface SupabaseFixture {
  docFound?: boolean;
  priorAiActions?: any[];
  priorWhatsapp?: any[];
  leadPhone?: string | null;
  lockAcquired?: boolean;
  sendMediaImpl?: () => Promise<any>;
}

function buildSupabase(fx: SupabaseFixture) {
  const ilikeCalls: any[] = [];
  const sendMedia = vi.fn(fx.sendMediaImpl ?? (async () => ({ message_id: "m-1" })));
  const rpc = vi.fn(async (name: string) => {
    if (name === "copilot_v2_acquire_dedup_lock") {
      return { data: fx.lockAcquired ?? true, error: null };
    }
    return { data: null, error: null };
  });

  const supabase: any = {
    rpc,
    from: vi.fn((table: string) => {
      switch (table) {
        case "copilot_agent_documents":
          return tableBuilder({
            data: fx.docFound === false ? null : {
              id: "doc-111",
              file_name: "Linha de produtos.mp4",
              file_path: "3f37decd/fc9cb9ca/1778310137920_Linha de produtos.mp4",
              mime_type: "video/mp4",
              organization_id: "org-111",
              file_type: "video",
            },
            error: fx.docFound === false ? { message: "not found" } : null,
          });
        case "pending_ai_actions":
          return tableBuilder({ data: fx.priorAiActions ?? [], error: null });
        case "whatsapp_messages": {
          const b = tableBuilder({ data: fx.priorWhatsapp ?? [], error: null });
          const origIlike = b.ilike;
          b.ilike = vi.fn((...a: any[]) => { ilikeCalls.push(a); return origIlike(...a); });
          return b;
        }
        case "leads":
          return tableBuilder({
            data: fx.leadPhone === undefined ? { phone: "+5581996381806" }
              : fx.leadPhone === null ? null : { phone: fx.leadPhone },
            error: null,
          });
        case "conversations":
          return tableBuilder({ data: { agent_id: "agent-y" }, error: null });
        case "whatsapp_instances":
          return tableBuilder({ data: null, error: null });
        case "copilot_v2_dedup_locks":
          return tableBuilder({ data: null, error: null });
        default:
          return tableBuilder({ data: null, error: null });
      }
    }),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async () => ({
          data: { signedUrl: "https://store/sign/agent-documents/...%20...mp4?token=t" },
          error: null,
        })),
      })),
    },
  };

  (resolveDispatchContext as any).mockResolvedValue({
    provider: { sendMedia },
    instance: { id: "inst-1" },
    normalizedPhone: "5581996381806",
  });

  return { supabase, sendMedia, rpc, ilikeCalls };
}

const VALID_DOC = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

beforeEach(() => {
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/* Layer-2 URL-encoding fix                                            */
/* ------------------------------------------------------------------ */

describe("checkDocumentAlreadySent — Layer-2 matches URL-encoded basename", () => {
  it("ILIKEs media_url with the encoded basename (spaces → %20), not the raw one", async () => {
    let captured: [string, string] | null = null;
    const wm = tableBuilder({ data: [], error: null });
    wm.ilike = vi.fn((col: string, pat: string) => { captured = [col, pat]; return wm; });

    const supabase: any = {
      from: vi.fn((t: string) =>
        t === "whatsapp_messages" ? wm
          : t === "leads" ? tableBuilder({ data: { phone: "+5581996381806" }, error: null })
            : tableBuilder({ data: [], error: null })),
    };

    const result = await checkDocumentAlreadySent(
      supabase,
      "conv-aaa",
      "doc-111",
      "lead-123",
      "3f37decd/fc9cb9ca/1778310137920_Linha de produtos.mp4",
    );

    expect(result).toBe(false);
    expect(captured).not.toBeNull();
    expect(captured![0]).toBe("media_url");
    // Decisive: the stored signed URL contains %20, so the pattern must too.
    expect(captured![1]).toBe("%1778310137920_Linha%20de%20produtos.mp4%");
    expect(captured![1]).not.toContain("Linha de produtos");
  });
});

/* ------------------------------------------------------------------ */
/* Atomic send lock                                                    */
/* ------------------------------------------------------------------ */

describe("executeSendDocument — atomic send lock (at-most-once)", () => {
  it("skips the send (no-op) when the lock is already held — the retry/orphan case", async () => {
    const { supabase, sendMedia, rpc } = buildSupabase({ lockAcquired: false });

    const result = await executeSendDocument(
      supabase, { document_id: VALID_DOC }, "org-111", "lead-123", "conv-aaa", "action-1",
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ skipped: true, reason: "send_lock_held" });
    // The decisive assertion: a held lock means the video is NEVER re-dispatched.
    expect(sendMedia).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "copilot_v2_acquire_dedup_lock",
      expect.objectContaining({
        p_dedup_key: "send_document:conv:conv-aaa:" + VALID_DOC + ":action:action-1",
      }),
    );
  });

  it("dispatches exactly once when the lock is acquired", async () => {
    const { supabase, sendMedia } = buildSupabase({ lockAcquired: true });

    const result = await executeSendDocument(
      supabase, { document_id: VALID_DOC }, "org-111", "lead-123", "conv-aaa", "action-1",
    );

    expect(result.success).toBe(true);
    expect(result.data).not.toMatchObject({ skipped: true });
    expect(sendMedia).toHaveBeenCalledTimes(1);
  });

  it("releases the lock on a real send failure so a legitimate retry can proceed", async () => {
    const { supabase } = buildSupabase({
      lockAcquired: true,
      sendMediaImpl: async () => { throw new Error("uazapi 500"); },
    });
    const deleteSpy = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
    const origFrom = supabase.from;
    supabase.from = vi.fn((t: string) => {
      if (t === "copilot_v2_dedup_locks") return { delete: deleteSpy };
      return origFrom(t);
    });

    const result = await executeSendDocument(
      supabase, { document_id: VALID_DOC }, "org-111", "lead-123", "conv-aaa", "action-1",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to send document");
    expect(deleteSpy).toHaveBeenCalled(); // lock released
  });

  it("falls back to a lead-scoped lock key when there is no conversation", async () => {
    const { supabase, rpc } = buildSupabase({ lockAcquired: false });

    await executeSendDocument(
      supabase, { document_id: VALID_DOC }, "org-111", "lead-123", null, "action-1",
    );

    expect(rpc).toHaveBeenCalledWith(
      "copilot_v2_acquire_dedup_lock",
      expect.objectContaining({
        p_dedup_key: "send_document:lead:lead-123:" + VALID_DOC + ":action:action-1",
      }),
    );
  });

  // 2026-09-03 — o defeito que este bloco existe para impedir de voltar.
  //
  // Com a chave ancorada só em (conversa, documento), a 1ª entrega tomava o lock
  // por 24h e QUALQUER pedido posterior do lead morria contra ele. Na Forever
  // Bella (02/09) o lead pediu a mesma foto 4 vezes em 2h e não recebeu nenhuma.
  // O `actionId` na chave separa "retry da mesma ação" (tem de colidir) de
  // "pedido novo do lead" (tem de passar).
  it("gives a NEW request its own lock — the lead asking again must not collide with the earlier delivery", async () => {
    const { supabase, rpc, sendMedia } = buildSupabase({ lockAcquired: true });

    await executeSendDocument(
      supabase, { document_id: VALID_DOC }, "org-111", "lead-123", "conv-aaa", "action-1",
    );
    await executeSendDocument(
      supabase, { document_id: VALID_DOC }, "org-111", "lead-123", "conv-aaa", "action-2",
    );

    const keys = rpc.mock.calls
      .filter((c: unknown[]) => c[0] === "copilot_v2_acquire_dedup_lock")
      .map((c: unknown[]) => (c[1] as { p_dedup_key: string }).p_dedup_key);

    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    // Decisive: the second ask actually put the file on the wire.
    expect(sendMedia).toHaveBeenCalledTimes(2);
  });

  // 🚨 A regra de produto, medida por MUTAÇÃO: com uma entrega REAL anterior na
  // mesma conversa, o envio novo tem de sair mesmo assim. Se alguém reintroduzir
  // o `return { skipped: true, reason: "duplicate_document" }`, este teste cai.
  it("sends anyway when the same document was already DELIVERED in this conversation", async () => {
    const { supabase, sendMedia } = buildSupabase({
      lockAcquired: true,
      priorAiActions: [
        {
          id: "action-old",
          // O id TEM de ser o mesmo que está sendo enviado agora — com um
          // `document_id` diferente o gate nunca casaria e o teste passaria
          // verde mesmo com o bloqueio de volta no lugar.
          payload: { document_id: VALID_DOC, delivered_at: "2026-09-02T17:27:18.882Z" },
        },
      ],
    });

    const result = await executeSendDocument(
      supabase, { document_id: VALID_DOC }, "org-111", "lead-123", "conv-aaa", "action-new",
    );

    expect(result.data).not.toMatchObject({ skipped: true });
    expect(result.data).not.toMatchObject({ reason: "duplicate_document" });
    expect(sendMedia).toHaveBeenCalledTimes(1);
  });

  it("keeps colliding when the SAME action is re-claimed — the 2026-06-02 incident stays fixed", async () => {
    const { supabase, rpc } = buildSupabase({ lockAcquired: false });

    await executeSendDocument(
      supabase, { document_id: VALID_DOC }, "org-111", "lead-123", "conv-aaa", "action-1",
    );
    await executeSendDocument(
      supabase, { document_id: VALID_DOC }, "org-111", "lead-123", "conv-aaa", "action-1",
    );

    const keys = rpc.mock.calls
      .filter((c: unknown[]) => c[0] === "copilot_v2_acquire_dedup_lock")
      .map((c: unknown[]) => (c[1] as { p_dedup_key: string }).p_dedup_key);

    expect(keys[0]).toBe(keys[1]);
  });
});
