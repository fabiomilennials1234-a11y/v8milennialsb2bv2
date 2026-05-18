// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockSupabase } from "../../helpers/supabase-mock";
import type { ActionInput } from "../../../supabase/functions/_shared/action-handlers/types";
import { createCalendarEvent } from "../../../supabase/functions/_shared/action-handlers/calendar-operations";

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

describe("createCalendarEvent", () => {
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

  it("calls google-calendar-events edge function", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    const result = await createCalendarEvent(makeInput({
      eventTitle: "Demo call",
      eventDescription: "With lead",
      eventDurationMinutes: 30,
    }));

    expect(result.success).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledOnce();

    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toContain("google-calendar-events");
    const body = JSON.parse(opts.body);
    expect(body.organization_id).toBe("org-1");
    expect(body.lead_id).toBe("lead-1");
    expect(body.title).toBe("Demo call");
    expect(body.duration_minutes).toBe(30);
  });

  it("returns error when edge function fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      text: () => Promise.resolve("Internal Server Error"),
    });

    const result = await createCalendarEvent(makeInput({
      eventTitle: "Demo",
    }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Calendar event failed");
  });

  it("uses defaults when title/duration missing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    const result = await createCalendarEvent(makeInput({}));

    expect(result.success).toBe(true);
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.title).toBe("Evento");
    expect(body.duration_minutes).toBe(60);
  });
});
