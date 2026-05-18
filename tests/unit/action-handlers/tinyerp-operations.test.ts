// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockSupabase } from "../../helpers/supabase-mock";
import type { ActionInput } from "../../../supabase/functions/_shared/action-handlers/types";
import {
  createTinyerpOrder,
  createTinyerpUpsellOrder,
} from "../../../supabase/functions/_shared/action-handlers/tinyerp-operations";

function makeInput(params: Record<string, unknown> = {}): ActionInput {
  const { sb } = createMockSupabase();
  return {
    supabase: sb,
    organizationId: "org-1",
    leadId: "lead-1",
    conversationId: null,
    params,
  };
}

describe("TinyERP operations", () => {
  const originalFetch = globalThis.fetch;
  const originalDeno = (globalThis as any).Deno;

  beforeEach(() => {
    (globalThis as any).Deno = {
      env: {
        get: (key: string) => {
          if (key === "SUPABASE_URL") return "https://test.supabase.co";
          if (key === "SUPABASE_SERVICE_ROLE_KEY") return "service-key-123";
          return undefined;
        },
      },
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalDeno) {
      (globalThis as any).Deno = originalDeno;
    } else {
      delete (globalThis as any).Deno;
    }
  });

  describe("createTinyerpOrder", () => {
    it("calls tinyerp-push-order edge function", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const result = await createTinyerpOrder(makeInput({ tinyProductId: "prod-1" }));

      expect(result.success).toBe(true);
      const [url, opts] = (globalThis.fetch as any).mock.calls[0];
      expect(url).toContain("tinyerp-push-order");
      const body = JSON.parse(opts.body);
      expect(body.organization_id).toBe("org-1");
      expect(body.lead_id).toBe("lead-1");
      expect(body.product_id).toBe("prod-1");
    });

    it("returns error on failure", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        text: () => Promise.resolve("Bad request"),
      });

      const result = await createTinyerpOrder(makeInput({}));

      expect(result.success).toBe(false);
      expect(result.error).toContain("TinyERP order failed");
    });
  });

  describe("createTinyerpUpsellOrder", () => {
    it("calls tinyerp-push-upsell-order edge function", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const result = await createTinyerpUpsellOrder(makeInput({ tinyProductId: "prod-2" }));

      expect(result.success).toBe(true);
      const [url] = (globalThis.fetch as any).mock.calls[0];
      expect(url).toContain("tinyerp-push-upsell-order");
    });
  });
});
