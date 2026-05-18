/**
 * Sentry observability for copilot batching (#206)
 *
 * Tests:
 * 1. agent-message emits copilot.absorb_iterations + copilot.lock_source tags
 * 2. send-document emits Sentry breadcrumb on duplicate block
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubGlobal("Deno", {
  env: {
    get: (k: string) => {
      const m: Record<string, string> = {
        SUPABASE_URL: "https://local.test",
        SUPABASE_SERVICE_ROLE_KEY: "svc-role",
        SENTRY_DSN: "https://key@sentry.io/123",
      };
      return m[k] ?? undefined;
    },
    toObject: () => ({}),
  },
  serve: () => {},
});

const mockCaptureMessage = vi.fn(async () => {});

vi.mock("../../supabase/functions/_shared/sentry.ts", () => ({
  withSentry: (_n: string, fn: unknown) => fn,
  captureError: vi.fn(async () => {}),
  captureMessage: mockCaptureMessage,
}));

vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn(async () => {}),
  redactSecrets: (v: unknown) => v,
}));

describe("copilot Sentry observability (#206)", () => {
  beforeEach(() => {
    mockCaptureMessage.mockClear();
  });

  describe("agent-message absorb loop tags", () => {
    it("emits copilot.absorb_iterations and copilot.lock_source after absorb loop", async () => {
      const { absorbPendingMessages } = await import(
        "../../supabase/functions/agent-message/batch-helpers.ts"
      );

      const claimed = [{ id: "q1", message_id: "m1" }];
      const msgs = [{ content: "hello" }];

      const supabase: any = {
        from: vi.fn((table: string) => {
          if (table === "copilot_message_queue") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              update: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnValue({ data: null, error: null }),
              then: (r: any) => r({ data: claimed, error: null }),
            };
          }
          if (table === "channel_messages") {
            return {
              select: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnValue({
                then: (r: any) => r({ data: msgs, error: null }),
              }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (r: any) => r({ data: null, error: null }),
          };
        }),
        rpc: vi.fn().mockResolvedValue({ data: claimed, error: null }),
      };

      const engine = {
        processMessage: vi.fn().mockResolvedValue({ action: "reply" }),
      };

      const result = await absorbPendingMessages({
        supabase,
        engine,
        leadId: "lead-1",
        from: "5511999990000",
        organizationId: "org-1",
      });

      expect(result.iterations).toBeGreaterThan(0);

      // The function should call captureMessage with absorb tags
      expect(mockCaptureMessage).toHaveBeenCalledWith(
        "copilot_absorb_completed",
        expect.objectContaining({
          tags: expect.objectContaining({
            "copilot.absorb_iterations": expect.any(Number),
            "copilot.lock_source": "db",
          }),
        }),
      );
    });

    it("does NOT emit absorb tags when no pending messages found", async () => {
      const { absorbPendingMessages } = await import(
        "../../supabase/functions/agent-message/batch-helpers.ts"
      );

      const supabase: any = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          then: (r: any) => r({ data: [], error: null }),
        })),
      };

      const engine = { processMessage: vi.fn() };

      const result = await absorbPendingMessages({
        supabase,
        engine,
        leadId: "lead-1",
        from: "5511999990000",
        organizationId: "org-1",
      });

      expect(result.iterations).toBe(0);
      expect(mockCaptureMessage).not.toHaveBeenCalled();
    });
  });

  describe("send-document dedup breadcrumb", () => {
    it("emits Sentry breadcrumb when duplicate document is blocked", async () => {
      const { checkDocumentAlreadySent } = await import(
        "../../supabase/functions/_shared/actions/send-document.ts"
      );

      // Mock: doc-111 already sent in conv-aaa
      const supabase: any = {
        from: vi.fn(() => {
          const builder: any = {
            select: vi.fn(() => builder),
            eq: vi.fn(() => builder),
            then: (r: any) =>
              r({ data: [{ id: "a1", payload: { document_id: "doc-111" } }], error: null }),
          };
          return builder;
        }),
      };

      const result = await checkDocumentAlreadySent(supabase, "conv-aaa", "doc-111");
      expect(result).toBe(true);

      // Should emit breadcrumb on duplicate detection
      expect(mockCaptureMessage).toHaveBeenCalledWith(
        "copilot_duplicate_document_blocked",
        expect.objectContaining({
          tags: expect.objectContaining({
            "copilot.document_id": "doc-111",
            "copilot.conversation_id": "conv-aaa",
          }),
        }),
      );
    });

    it("does NOT emit breadcrumb when document is not a duplicate", async () => {
      const { checkDocumentAlreadySent } = await import(
        "../../supabase/functions/_shared/actions/send-document.ts"
      );

      const supabase: any = {
        from: vi.fn(() => {
          const builder: any = {
            select: vi.fn(() => builder),
            eq: vi.fn(() => builder),
            then: (r: any) => r({ data: [], error: null }),
          };
          return builder;
        }),
      };

      const result = await checkDocumentAlreadySent(supabase, "conv-aaa", "doc-new");
      expect(result).toBe(false);
      expect(mockCaptureMessage).not.toHaveBeenCalled();
    });
  });
});
