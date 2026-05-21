/**
 * send-document dedup gate — Layer 2 hard guard.
 *
 * Prevents the same document from being sent twice in the same conversation.
 * Exercises checkDocumentAlreadySent which queries pending_ai_actions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub Deno global for ESM imports
vi.stubGlobal("Deno", {
  env: {
    get: (k: string) => {
      const m: Record<string, string> = {
        SUPABASE_URL: "https://local.test",
        SUPABASE_SERVICE_ROLE_KEY: "svc-role",
      };
      return m[k] ?? undefined;
    },
    toObject: () => ({}),
  },
  serve: () => {},
});

// Minimal mocks for transitive deps
vi.mock("../../supabase/functions/_shared/sentry.ts", () => ({
  withSentry: (_n: string, fn: unknown) => fn,
  captureError: vi.fn(async () => {}),
  captureMessage: vi.fn(async () => {}),
}));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn(async () => {}),
  redactSecrets: (v: unknown) => v,
}));
vi.mock("../../supabase/functions/_shared/whatsapp-dispatch.ts", () => ({
  resolveDispatchContext: vi.fn(),
  DispatchResolutionError: class extends Error {},
}));
vi.mock("../../supabase/functions/_shared/copilot/cancellation.ts", () => ({
  isCopilotCanceled: vi.fn(async () => ({ canceled: false })),
  logCopilotCancellation: vi.fn(),
}));

import { checkDocumentAlreadySent, executeSendDocument } from "../../supabase/functions/_shared/actions/send-document.ts";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function buildSupabaseMock(resolvedValue: { data: any[] | null; error: any }) {
  // Supabase PostgREST chain: .from().select().eq().eq().in() → Promise
  // Every method returns `this`; the chain is thenable (auto-resolves).
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    // Make it thenable so `await` resolves to our value
    then: (resolve: any) => resolve(resolvedValue),
  };
  return {
    from: vi.fn(() => builder),
    _builder: builder,
  };
}

function buildSupabaseMockMultiTable(tables: Record<string, { data: any; error: any }>) {
  const fromFn = vi.fn((tableName: string) => {
    const resolved = tables[tableName] || { data: null, error: null };
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      ilike: vi.fn(() => builder),
      gte: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      single: vi.fn(() => builder),
      maybeSingle: vi.fn(() => builder),
      then: (resolve: any) => resolve(resolved),
    };
    return builder;
  });
  return { from: fromFn };
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("checkDocumentAlreadySent", () => {
  it("returns false when no prior send exists", async () => {
    const supabase = buildSupabaseMock({ data: [], error: null });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
    );
    expect(result).toBe(false);
  });

  it("returns true when same doc already sent in same conversation", async () => {
    const supabase = buildSupabaseMock({
      data: [{ id: "action-1", payload: { document_id: "doc-111" } }],
      error: null,
    });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
    );
    expect(result).toBe(true);
  });

  it("returns false when same doc sent in DIFFERENT conversation (query scoped)", async () => {
    // The function filters by conversation_id, so different conv → empty result.
    const supabase = buildSupabaseMock({ data: [], error: null });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-bbb",
      "doc-111",
    );
    expect(result).toBe(false);
    // Verify conversation_id was passed to .eq()
    expect(supabase._builder.eq).toHaveBeenCalledWith("conversation_id", "conv-bbb");
  });

  it("returns false when different doc in same conversation", async () => {
    // Conversation has a completed send_document, but for a DIFFERENT document_id.
    // In-memory payload filter must reject the match.
    const supabase = buildSupabaseMock({
      data: [{ id: "action-1", payload: { document_id: "doc-111" } }],
      error: null,
    });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-222",
    );
    expect(result).toBe(false);
  });

  it("returns true when action is in 'processing' status (retry-safe dedup)", async () => {
    // Action sent video successfully but crashed before marking completed.
    // Re-claim picks it up — dedup must still block.
    const supabase = buildSupabaseMock({
      data: [{ id: "action-1", payload: { document_id: "doc-111" } }],
      error: null,
    });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
    );
    expect(result).toBe(true);
    // Verify query includes both completed AND processing statuses
    expect(supabase._builder.in).toHaveBeenCalledWith(
      "status",
      ["completed", "processing"],
    );
  });

  it("returns true via whatsapp_messages fallback when a prior media msg matches the file basename", async () => {
    // Scenario: pending_ai_action was lost (cleanup, manual delete) but the
    // media itself was already delivered. whatsapp_messages secondary gate
    // catches it via media_url ILIKE on the storage path basename.
    const supabase = buildSupabaseMockMultiTable({
      pending_ai_actions: { data: [], error: null },
      whatsapp_messages: { data: [{ id: "wm-1" }], error: null },
      leads: { data: { phone: "+5581986416680" }, error: null },
    });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
      "lead-123",
      "org-x/agent-y/123_video.mp4",
    );
    expect(result).toBe(true);
  });

  it("returns false when no match in either pending_ai_actions or whatsapp_messages", async () => {
    const supabase = buildSupabaseMockMultiTable({
      pending_ai_actions: { data: [], error: null },
      whatsapp_messages: { data: [], error: null },
      leads: { data: { phone: "+5581986416680" }, error: null },
    });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
      "lead-123",
      "org-x/agent-y/123_video.mp4",
    );
    expect(result).toBe(false);
  });

  it("Barulinho regression: text reply in last 1h does NOT block a fresh video", async () => {
    // The previous fallback fired on ANY outgoing AI message in 1h, blocking
    // 100% of videos that followed engagement text. The fallback must only
    // trigger on a real media_url match for the same file basename.
    const supabase = buildSupabaseMockMultiTable({
      pending_ai_actions: { data: [], error: null },
      // ilike(media_url, %123_video.mp4%) → no match: query returns empty.
      whatsapp_messages: { data: [], error: null },
      leads: { data: { phone: "+5581986416680" }, error: null },
    });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
      "lead-123",
      "org-x/agent-y/123_video.mp4",
    );
    expect(result).toBe(false);
  });

  it("skips whatsapp_messages gate when no leadId provided", async () => {
    const supabase = buildSupabaseMock({ data: [], error: null });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
    );
    expect(result).toBe(false);
    // Only pending_ai_actions was queried (from() called once)
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("skips whatsapp_messages gate when no filePath provided", async () => {
    // leadId without filePath cannot perform a meaningful media_url match —
    // gate falls through rather than over-block.
    const supabase = buildSupabaseMock({ data: [], error: null });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
      "lead-123",
    );
    expect(result).toBe(false);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});

describe("executeSendDocument — UUID validation", () => {
  it("rejects non-UUID document_id with error", async () => {
    const supabase = buildSupabaseMockMultiTable({
      pending_ai_actions: { data: [], error: null },
    });
    const result = await executeSendDocument(
      supabase as any,
      { document_id: "WhatsApp Video 2026-04-27 at 09.19.40.mp4" },
      "org-111",
      "lead-123",
      "conv-aaa",
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("document_id");
  });

  it("accepts valid UUID document_id (fails downstream, not on validation)", async () => {
    const supabase = buildSupabaseMockMultiTable({
      pending_ai_actions: { data: [], error: null },
      leads: { data: null, error: null },
      copilot_agent_documents: { data: null, error: { message: "not found" } },
    });
    const result = await executeSendDocument(
      supabase as any,
      { document_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
      "org-111",
      "lead-123",
      "conv-aaa",
    );
    // Fails on "Document not found", NOT on UUID validation
    expect(result.success).toBe(false);
    expect(result.error).not.toContain("invalid");
    expect(result.error).toContain("not found");
  });
});
