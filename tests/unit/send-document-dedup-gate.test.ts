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
}));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn(async () => {}),
  redactSecrets: (v: unknown) => v,
}));

import { checkDocumentAlreadySent } from "../../supabase/functions/_shared/actions/send-document.ts";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function buildSupabaseMock(resolvedValue: { data: any[] | null; error: any }) {
  // Supabase PostgREST chain: .from().select().eq().eq().eq() → Promise
  // Every method returns `this`; the chain is thenable (auto-resolves).
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    // Make it thenable so `await` resolves to our value
    then: (resolve: any) => resolve(resolvedValue),
  };
  return {
    from: vi.fn(() => builder),
    _builder: builder,
  };
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
});
