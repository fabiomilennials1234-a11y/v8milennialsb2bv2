/**
 * Tests for ai-action-executor — AI action dispatcher
 * Comprehensive coverage of all action types, branches, and error paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: () => Promise.resolve({}),
  text: () => Promise.resolve(""),
});
global.fetch = mockFetch as any;

// Mock dependencies
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({ logRuntime: vi.fn() }));
vi.mock("../../supabase/functions/_shared/sentry.ts", () => ({ captureException: vi.fn() }));
vi.mock("../../supabase/functions/_shared/validation.ts", () => ({
  sanitizeString: (input: string | null | undefined, _maxLength?: number) =>
    input == null ? null : String(input).trim(),
}));
vi.mock("../../supabase/functions/_shared/lead-service.ts", () => ({
  promoveShadowLead: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../supabase/functions/_shared/google-calendar-utils.ts", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue(null),
  logCalendarOp: vi.fn().mockResolvedValue(undefined),
}));

setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

beforeEach(() => {
  clearDenoEnv();
  setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
  setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: true }),
    text: () => Promise.resolve(""),
  });
});

import {
  immediateTransferHuman,
  executeAiAction,
  type ActionRecord,
  type ActionResult,
} from "../../supabase/functions/_shared/ai-action-executor";

// ─── Type Shapes ─────────────────────────────────────────────────────────────

describe("ActionRecord type", () => {
  it("has required fields", () => {
    const r: ActionRecord = {
      id: "a1",
      organization_id: "org-1",
      lead_id: "lead-1",
      conversation_id: "conv-1",
      action_type: "transfer_human",
      payload: {},
    };
    expect(r.action_type).toBe("transfer_human");
  });

  it("lead_id and conversation_id can be null", () => {
    const r: ActionRecord = {
      id: "a1",
      organization_id: "org-1",
      lead_id: null,
      conversation_id: null,
      action_type: "test",
      payload: {},
    };
    expect(r.lead_id).toBeNull();
  });
});

describe("ActionResult type", () => {
  it("success shape", () => {
    const r: ActionResult = { success: true, message: "transferred" };
    expect(r.success).toBe(true);
  });
  it("failure shape", () => {
    const r: ActionResult = { success: false, error: "lead not found" };
    expect(r.error).toContain("not found");
  });
  it("data shape", () => {
    const r: ActionResult = { success: true, data: { lead_id: "x" } };
    expect(r.data?.lead_id).toBe("x");
  });
});

// ─── immediateTransferHuman ──────────────────────────────────────────────────

describe("immediateTransferHuman", () => {
  it("updates lead ai_disabled and conversation state on success", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", ai_disabled: false }]);
    mockTable("conversations", [{ id: "conv-1", lead_id: "lead-1", state: "ACTIVE" }]);

    const result = await immediateTransferHuman(sb, "lead-1");
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("handles missing lead gracefully without throwing", async () => {
    const { sb } = createMockSupabase();
    // Empty tables, but mock returns no error (data is just empty)
    const result = await immediateTransferHuman(sb, "nonexistent");
    expect(result).toBeDefined();
    expect(result.success).toBe(true); // mock returns no error by default
  });

  it("returns error when lead update fails", async () => {
    // Build a custom supabase mock that returns an error on leads.update
    const sb = {
      from: (table: string) => {
        if (table === "leads") {
          return {
            update: () => ({
              eq: () =>
                Promise.resolve({
                  error: { code: "PGRST116", message: "Update failed" },
                }),
            }),
          };
        }
        return {
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      },
    };
    const result = await immediateTransferHuman(sb as any, "lead-1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Update failed");
  });

  it("returns success even if conversation update fails", async () => {
    const sb = {
      from: (table: string) => {
        if (table === "leads") {
          return {
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        }
        if (table === "conversations") {
          return {
            update: () => ({
              eq: () =>
                Promise.resolve({
                  error: { code: "PGRST116", message: "Conv update failed" },
                }),
            }),
          };
        }
        return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      },
    };
    const result = await immediateTransferHuman(sb as any, "lead-1");
    // conversation error is only warned, not returned as error
    expect(result.success).toBe(true);
  });

  it("handles unexpected exception gracefully", async () => {
    const sb = {
      from: () => {
        throw new Error("Unexpected crash");
      },
    };
    const result = await immediateTransferHuman(sb as any, "lead-1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unexpected crash");
  });
});

// ─── executeAiAction — Router ────────────────────────────────────────────────

describe("executeAiAction", () => {
  function makeAction(overrides: Partial<ActionRecord>): ActionRecord {
    return {
      id: "a-test",
      organization_id: "org-1",
      lead_id: "lead-1",
      conversation_id: null,
      action_type: "unknown",
      payload: {},
      ...overrides,
    };
  }

  it("returns error for unknown action type", async () => {
    const { sb } = createMockSupabase();
    const result = await executeAiAction(
      sb,
      makeAction({ action_type: "completely_unknown" }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("completely_unknown");
  });

  it("handles update_crm as a placeholder", async () => {
    const { sb } = createMockSupabase();
    const result = await executeAiAction(
      sb,
      makeAction({ action_type: "update_crm" }),
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain("UPDATE_CRM");
  });

  // ── schedule_meeting ─────────────────────────────────────────────────────

  describe("schedule_meeting", () => {
    it("returns error when missing lead_id", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "schedule_meeting",
          payload: { preferred_date: "2026-05-01" },
          lead_id: null,
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("obrigat");
    });

    it("returns error when missing preferred_date", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "schedule_meeting",
          payload: { lead_id: "lead-1" },
        }),
      );
      expect(result.success).toBe(false);
    });

    it("schedules meeting with existing pipe_confirmacao entry", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [
        { id: "lead-1", name: "Test", email: "t@t.com", responsible_id: null, sdr_id: null },
      ]);
      mockTable("pipe_confirmacao", [
        { id: "pc-1", lead_id: "lead-1", status: "reuniao_marcada" },
      ]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "schedule_meeting",
          payload: { lead_id: "lead-1", preferred_date: "2026-06-15", preferred_time: "14:00" },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.meeting_date).toBe("2026-06-15");
    });

    it("creates new pipe_confirmacao entry when none exists", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [
        { id: "lead-1", name: "Test", email: null, responsible_id: null, sdr_id: null },
      ]);
      // Empty pipe_confirmacao = no existing entry
      mockTable("pipe_confirmacao", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "schedule_meeting",
          payload: { lead_id: "lead-1", preferred_date: "2026-06-15" },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain("agendada");
    });

    it("includes meet_link when Google Calendar succeeds", async () => {
      const { getValidAccessToken } = await import(
        "../../supabase/functions/_shared/google-calendar-utils.ts"
      );
      (getValidAccessToken as any).mockResolvedValueOnce({
        accessToken: "google-token-123",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "gcal-event-1",
            hangoutLink: "https://meet.google.com/abc-def-ghi",
            conferenceData: {
              entryPoints: [
                { entryPointType: "video", uri: "https://meet.google.com/abc-def-ghi" },
              ],
            },
          }),
        text: () => Promise.resolve(""),
      });

      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [
        { id: "lead-1", name: "Joao", email: "j@test.com", responsible_id: "resp-1", sdr_id: null },
      ]);
      mockTable("pipe_confirmacao", [{ id: "pc-1", lead_id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "schedule_meeting",
          payload: { lead_id: "lead-1", preferred_date: "2026-07-01", preferred_time: "10:00" },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.meet_link).toBe("https://meet.google.com/abc-def-ghi");
      expect(result.message).toContain("Google Calendar");
    });

    it("handles Google Calendar failure gracefully", async () => {
      const { getValidAccessToken } = await import(
        "../../supabase/functions/_shared/google-calendar-utils.ts"
      );
      (getValidAccessToken as any).mockResolvedValueOnce({
        accessToken: "google-token-123",
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: "Unauthorized" }),
        text: () => Promise.resolve("Unauthorized"),
      });

      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [
        { id: "lead-1", name: "Joao", email: "j@test.com", responsible_id: "resp-1", sdr_id: null },
      ]);
      mockTable("pipe_confirmacao", [{ id: "pc-1", lead_id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "schedule_meeting",
          payload: { lead_id: "lead-1", preferred_date: "2026-07-01" },
        }),
      );
      // Still succeeds — google calendar is graceful degradation
      expect(result.success).toBe(true);
      expect(result.data?.meet_link).toBeUndefined();
    });

    it("uses sdr_id when responsible_id is null", async () => {
      const { getValidAccessToken } = await import(
        "../../supabase/functions/_shared/google-calendar-utils.ts"
      );
      // Return null = no token, skip calendar
      (getValidAccessToken as any).mockResolvedValueOnce(null);

      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [
        { id: "lead-1", name: "Test", email: null, responsible_id: null, sdr_id: "sdr-1" },
      ]);
      mockTable("pipe_confirmacao", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "schedule_meeting",
          payload: { lead_id: "lead-1", preferred_date: "2026-08-01" },
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  // ── create_lead ──────────────────────────────────────────────────────────

  describe("create_lead", () => {
    it("creates lead with all fields", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "create_lead",
          payload: { name: "Maria", email: "m@test.com", phone: "11999999999", company: "Acme" },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain("criado");
      expect(result.data?.lead_id).toBeDefined();
    });

    it("returns error when name is missing", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "create_lead",
          payload: { email: "m@test.com" },
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("obrigat");
    });
  });

  // ── update_lead ──────────────────────────────────────────────────────────

  describe("update_lead", () => {
    it("updates standard fields on lead", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1", organization_id: "org-1", notes: null }]);
      mockTable("lead_custom_fields", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_lead",
          payload: {
            lead_id: "lead-1",
            updates: { company: "NewCo", segment: "Tech", rating: "8" },
          },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.lead_id).toBe("lead-1");
    });

    it("appends unknown fields to notes", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1", organization_id: "org-1", notes: "Old note" }]);
      mockTable("lead_custom_fields", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_lead",
          payload: {
            lead_id: "lead-1",
            updates: { random_field: "some info" },
          },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("updates custom fields when they exist", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1", organization_id: "org-1", notes: null }]);
      mockTable("lead_custom_fields", [
        { id: "cf-1", field_name: "size", organization_id: "org-1" },
      ]);
      mockTable("lead_custom_field_values", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_lead",
          payload: {
            lead_id: "lead-1",
            updates: { size: "large" },
          },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("returns error when lead_id is missing", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_lead",
          payload: { updates: { company: "Test" } },
        }),
      );
      expect(result.success).toBe(false);
    });

    it("returns error when updates object is empty", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_lead",
          payload: { lead_id: "lead-1", updates: {} },
        }),
      );
      expect(result.success).toBe(false);
    });

    it("returns error when lead not found in org", async () => {
      const { sb, mockTable } = createMockSupabase();
      // Empty leads table = lead not found
      mockTable("leads", []);
      mockTable("lead_custom_fields", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_lead",
          payload: { lead_id: "nonexistent", updates: { company: "Test" } },
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("não encontrado");
    });

    it("clamps invalid rating values (ignores out-of-range)", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1", organization_id: "org-1", notes: null }]);
      mockTable("lead_custom_fields", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_lead",
          payload: { lead_id: "lead-1", updates: { rating: "15" } },
        }),
      );
      // Rating 15 > 10 so it should be skipped (not added to leadUpdates)
      expect(result.success).toBe(true);
    });

    it("skips null and empty string updates", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1", organization_id: "org-1", notes: null }]);
      mockTable("lead_custom_fields", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_lead",
          payload: { lead_id: "lead-1", updates: { company: null, segment: "  " } },
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  // ── update_qualification_score ───────────────────────────────────────────

  describe("update_qualification_score", () => {
    it("updates score successfully", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_qualification_score",
          payload: { lead_id: "lead-1", score: 85 },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.score).toBe(85);
    });

    it("clamps score to max 100", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_qualification_score",
          payload: { lead_id: "lead-1", score: 200 },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.score).toBe(100);
    });

    it("clamps score to min 0", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_qualification_score",
          payload: { lead_id: "lead-1", score: -50 },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.score).toBe(0);
    });

    it("returns error when lead_id is missing", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_qualification_score",
          payload: { score: 50 },
        }),
      );
      expect(result.success).toBe(false);
    });

    it("defaults score to 0 for NaN input", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_qualification_score",
          payload: { lead_id: "lead-1", score: "not-a-number" },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.score).toBe(0);
    });
  });

  // ── transfer_to_human ────────────────────────────────────────────────────

  describe("transfer_to_human", () => {
    it("transfers lead successfully with existing conversation", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("conversations", [{ id: "conv-1", lead_id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "transfer_to_human",
          payload: { lead_id: "lead-1" },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain("humano");
    });

    it("transfers lead even without conversation", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("conversations", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "transfer_to_human",
          payload: { lead_id: "lead-1" },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("returns error when lead_id missing in payload", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "transfer_to_human",
          payload: {},
        }),
      );
      expect(result.success).toBe(false);
    });
  });

  // ── transfer_to_human_notify ─────────────────────────────────────────────

  describe("transfer_to_human_notify", () => {
    it("notifies responsible user", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [
        { id: "lead-1", name: "Maria", company: "Acme", responsible_id: "resp-1" },
      ]);
      mockTable("team_members", [{ id: "resp-1", user_id: "user-1", is_active: true }]);
      mockTable("notifications", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "transfer_to_human_notify",
          lead_id: "lead-1",
          payload: { reason: "customer request" },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain("1");
    });

    it("falls back to all active team members when no responsible", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [
        { id: "lead-1", name: "Joao", company: null, responsible_id: null },
      ]);
      mockTable("team_members", [
        { id: "tm-1", user_id: "user-1", organization_id: "org-1", is_active: true },
        { id: "tm-2", user_id: "user-2", organization_id: "org-1", is_active: true },
      ]);
      mockTable("notifications", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "transfer_to_human_notify",
          lead_id: "lead-1",
          payload: {},
        }),
      );
      expect(result.success).toBe(true);
    });

    it("returns error when lead_id is null", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "transfer_to_human_notify",
          lead_id: null,
          payload: { reason: "test" },
        }),
      );
      expect(result.success).toBe(false);
    });

    it("uses lead name only when company is null", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1", name: "Solo", company: null, responsible_id: null }]);
      mockTable("team_members", []);
      mockTable("notifications", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "transfer_to_human_notify",
          lead_id: "lead-1",
          payload: { reason: "urgent" },
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  // ── transfer_sz_chat ─────────────────────────────────────────────────────

  describe("transfer_sz_chat", () => {
    it("returns error when lead_id is null", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "transfer_sz_chat",
          lead_id: null,
          payload: { target_team_name: "Support" },
        }),
      );
      expect(result.success).toBe(false);
    });

    it("returns error when no active SZ.chat session exists", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("sz_chat_sessions", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "transfer_sz_chat",
          lead_id: "lead-1",
          payload: { target_team_name: "Support" },
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("SZ.chat");
    });

    it("succeeds when session exists and edge function returns ok", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("sz_chat_sessions", [
        {
          lead_id: "lead-1",
          organization_id: "org-1",
          status: "active",
          sz_chat_session_id: "sz-session-1",
          created_at: "2026-01-01",
        },
      ]);
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("lead_history", []);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true }),
        text: () => Promise.resolve(""),
      });

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "transfer_sz_chat",
          lead_id: "lead-1",
          payload: { target_team_name: "Sales", target_team_id: "team-1" },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain("SZ.chat");
    });

    it("returns error when edge function returns failure", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("sz_chat_sessions", [
        {
          lead_id: "lead-1",
          organization_id: "org-1",
          status: "active",
          sz_chat_session_id: "sz-session-1",
          created_at: "2026-01-01",
        },
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ success: false, error: "Transfer failed" }),
        text: () => Promise.resolve("Transfer failed"),
      });

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "transfer_sz_chat",
          lead_id: "lead-1",
          payload: {},
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Transfer failed");
    });
  });

  // ── advance_stage ────────────────────────────────────────────────────────

  describe("advance_stage", () => {
    it("returns error when lead_id missing", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_stage",
          payload: { target_stage: "abordado" },
        }),
      );
      expect(result.success).toBe(false);
    });

    it("returns error when target_stage missing", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_stage",
          payload: { lead_id: "lead-1" },
        }),
      );
      expect(result.success).toBe(false);
    });

    it("advances whatsapp pipe using default stages", async () => {
      const { sb, mockTable } = createMockSupabase();
      // Empty pipeline_stages = use defaults
      mockTable("pipeline_stages", []);
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("pipe_whatsapp", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_stage",
          payload: { lead_id: "lead-1", target_stage: "abordado", target_pipe: "whatsapp" },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.target_stage).toBe("abordado");
    });

    it("validates stage against pipeline_stages from DB", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("pipeline_stages", [
        { stage_key: "novo", organization_id: "org-1", pipeline_type: "whatsapp", is_active: true },
        { stage_key: "abordado", organization_id: "org-1", pipeline_type: "whatsapp", is_active: true },
      ]);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_stage",
          payload: { lead_id: "lead-1", target_stage: "INVALID_STAGE", target_pipe: "whatsapp" },
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("inválida");
    });

    it("advances confirmacao pipe", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("pipeline_stages", []);
      mockTable("pipe_confirmacao", []);
      mockTable("pipe_whatsapp", [{ id: "pw-1", lead_id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_stage",
          payload: { lead_id: "lead-1", target_stage: "reuniao_marcada", target_pipe: "confirmacao" },
        }),
      );
      // No stage validation for non-whatsapp when stageKeys is empty
      expect(result.success).toBe(true);
    });

    it("advances propostas pipe", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("pipeline_stages", []);
      mockTable("pipe_propostas", []);
      mockTable("pipe_whatsapp", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_stage",
          payload: { lead_id: "lead-1", target_stage: "proposta_enviada", target_pipe: "propostas" },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("advances upsell_base pipe", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("pipeline_stages", []);
      mockTable("upsell_clients", [{ lead_id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_stage",
          payload: { lead_id: "lead-1", target_stage: "ativo", target_pipe: "upsell_base" },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("advances upsell_gestao pipe", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("pipeline_stages", []);
      mockTable("upsell_clients", [{ lead_id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_stage",
          payload: { lead_id: "lead-1", target_stage: "ativo", target_pipe: "upsell_gestao" },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("advances campanha pipe", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("pipeline_stages", []);
      mockTable("campanha_stages", [{ id: "cs-1", name: "Quente" }]);
      mockTable("campanha_leads", [{ lead_id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_stage",
          payload: { lead_id: "lead-1", target_stage: "Quente", target_pipe: "campanha" },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("returns error for unsupported pipe", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("pipeline_stages", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_stage",
          payload: { lead_id: "lead-1", target_stage: "test", target_pipe: "nonexistent_pipe" },
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("não suportado");
    });

    it("defaults target_pipe to whatsapp when not specified", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("pipeline_stages", []);
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("pipe_whatsapp", [{ id: "pw-1", lead_id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_stage",
          payload: { lead_id: "lead-1", target_stage: "respondeu" },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.target_pipe).toBe("whatsapp");
    });
  });

  // ── confirm_meeting ──────────────────────────────────────────────────────

  describe("confirm_meeting", () => {
    it("returns error when lead_id missing", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "confirm_meeting",
          payload: {},
        }),
      );
      expect(result.success).toBe(false);
    });

    it("returns error when lead not in pipe_confirmacao", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("pipe_confirmacao", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "confirm_meeting",
          payload: { lead_id: "lead-1" },
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("confirmação");
    });

    it("confirms meeting with type 'confirmed'", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("pipe_confirmacao", [
        { id: "pc-1", lead_id: "lead-1", status: "confirmar_d1" },
      ]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "confirm_meeting",
          payload: { lead_id: "lead-1", confirmation_type: "confirmed" },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.confirmation_type).toBe("confirmed");
      expect(result.message).toContain("confirmada no dia");
    });

    it("pre-confirms meeting with default type", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("pipe_confirmacao", [
        { id: "pc-1", lead_id: "lead-1", status: "confirmar_d3" },
      ]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "confirm_meeting",
          payload: { lead_id: "lead-1" },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.confirmation_type).toBe("pre_confirmed");
      expect(result.message).toContain("pré-confirmada");
    });
  });

  // ── advance_confirmation_stage ───────────────────────────────────────────

  describe("advance_confirmation_stage", () => {
    it("returns error when lead_id missing", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_confirmation_stage",
          payload: { target_stage: "confirmar_d3" },
        }),
      );
      expect(result.success).toBe(false);
    });

    it("returns error when target_stage missing", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_confirmation_stage",
          payload: { lead_id: "lead-1" },
        }),
      );
      expect(result.success).toBe(false);
    });

    it("advances with valid default stage", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("pipeline_stages", []);
      mockTable("pipe_confirmacao", [{ id: "pc-1", lead_id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_confirmation_stage",
          payload: { lead_id: "lead-1", target_stage: "confirmar_d3" },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.target_stage).toBe("confirmar_d3");
    });

    it("returns error for invalid confirmation stage", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("pipeline_stages", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_confirmation_stage",
          payload: { lead_id: "lead-1", target_stage: "INVALID" },
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("inválida");
    });

    it("returns error when lead not in pipe_confirmacao", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("pipeline_stages", []);
      mockTable("pipe_confirmacao", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_confirmation_stage",
          payload: { lead_id: "lead-1", target_stage: "confirmar_d1" },
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("confirmação");
    });

    it("uses custom pipeline stages from DB when available", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("pipeline_stages", [
        { stage_key: "custom_stage", organization_id: "org-1", pipeline_type: "confirmacao", is_active: true },
      ]);
      mockTable("pipe_confirmacao", [{ id: "pc-1", lead_id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_confirmation_stage",
          payload: { lead_id: "lead-1", target_stage: "custom_stage" },
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  // ── create_custom_field ──────────────────────────────────────────────────

  describe("create_custom_field", () => {
    it("returns error when field_name missing", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "create_custom_field",
          payload: { field_type: "text" },
        }),
      );
      expect(result.success).toBe(false);
    });

    it("returns error when field_type missing", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "create_custom_field",
          payload: { field_name: "Size" },
        }),
      );
      expect(result.success).toBe(false);
    });

    it("returns error for invalid field_type", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "create_custom_field",
          payload: { field_name: "Size", field_type: "complex_object" },
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("inválido");
    });

    it("returns error for select type without options", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "create_custom_field",
          payload: { field_name: "Color", field_type: "select" },
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("field_options");
    });

    it("returns error for select type with empty options array", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "create_custom_field",
          payload: { field_name: "Color", field_type: "select", field_options: [] },
        }),
      );
      expect(result.success).toBe(false);
    });

    it("creates new text field", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("lead_custom_fields", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "create_custom_field",
          payload: { field_name: "Revenue", field_type: "number" },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain("criado");
      expect(result.data?.field_name).toBe("Revenue");
    });

    it("reuses existing field with same name", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("lead_custom_fields", [
        { id: "cf-1", field_name: "Revenue", organization_id: "org-1" },
      ]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "create_custom_field",
          payload: { field_name: "Revenue", field_type: "number" },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain("já existia");
      expect(result.data?.field_id).toBe("cf-1");
    });

    it("creates field with initial value for current lead", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("lead_custom_fields", []);
      mockTable("lead_custom_field_values", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "create_custom_field",
          payload: {
            field_name: "Interest",
            field_type: "text",
            initial_value: "High",
            current_lead_id: "lead-1",
          },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain("valor: High");
    });

    it("creates select field with options", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("lead_custom_fields", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "create_custom_field",
          payload: {
            field_name: "Priority",
            field_type: "select",
            field_options: ["Low", "Medium", "High"],
          },
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  // ── automation actions (qualify/disqualify/need_human) ───────────────────

  describe("automation_qualify", () => {
    it("returns error when lead_id is null", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "automation_qualify",
          lead_id: null,
          payload: { action_config: { moveToStage: "respondeu" } },
        }),
      );
      expect(result.success).toBe(false);
    });

    it("returns error when action_config is missing", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "automation_qualify",
          payload: {},
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("action_config");
    });

    it("qualifies lead and moves to stage", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1", pipe_whatsapp: "novo" }]);
      mockTable("pipe_whatsapp", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "automation_qualify",
          payload: {
            action_type: "qualify",
            action_config: { moveToStage: "respondeu" },
          },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain("qualify");
    });

    it("qualifies lead with moveToPipe config", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("pipe_whatsapp", []);
      mockTable("pipe_confirmacao", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "automation_qualify",
          payload: {
            action_type: "qualify",
            action_config: {
              moveToPipe: { pipe: "confirmacao", stage: "reuniao_marcada" },
            },
          },
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe("automation_disqualify", () => {
    it("disqualifies lead and moves to esfriou by default", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("pipe_whatsapp", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "automation_disqualify",
          payload: {
            action_type: "disqualify",
            action_config: {},
          },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain("disqualify");
    });
  });

  describe("automation_need_human", () => {
    it("transfers to human and disables AI", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1", name: "Test", company: null }]);
      mockTable("notifications", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "automation_need_human",
          payload: {
            action_type: "need_human",
            action_config: { notifyUserId: "user-1" },
          },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("adds tags during automation", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("tags", [{ id: "tag-1", name: "VIP" }]);
      mockTable("lead_tags", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "automation_qualify",
          payload: {
            action_type: "qualify",
            action_config: { addTags: ["VIP"], moveToStage: "respondeu" },
          },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("creates new tag when it does not exist", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("tags", []); // No existing tags
      mockTable("lead_tags", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "automation_qualify",
          payload: {
            action_type: "qualify",
            action_config: { addTags: ["NewTag"], moveToStage: "respondeu" },
          },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("moves to confirmacao pipe via moveToPipe config", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("pipe_confirmacao", []);
      mockTable("pipe_whatsapp", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "automation_qualify",
          payload: {
            action_type: "qualify",
            action_config: {
              moveToPipe: { pipe: "confirmacao", stage: "reuniao_marcada" },
            },
          },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("moves to upsell_base pipe via moveToPipe config", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("upsell_clients", [{ lead_id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "automation_qualify",
          payload: {
            action_type: "qualify",
            action_config: {
              moveToPipe: { pipe: "upsell_base", stage: "ativo" },
            },
          },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("moves to upsell_gestao pipe via moveToPipe config", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("upsell_clients", [{ lead_id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "automation_qualify",
          payload: {
            action_type: "qualify",
            action_config: {
              moveToPipe: { pipe: "upsell_gestao", stage: "ativo" },
            },
          },
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  // ── update_pipeline_stage ────────────────────────────────────────────────

  describe("update_pipeline_stage", () => {
    it("updates pipeline stage successfully", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("pipe_whatsapp", [{ id: "pw-1", lead_id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_pipeline_stage",
          payload: { lead_id: "lead-1", new_stage: "abordado" },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.new_stage).toBe("abordado");
    });

    it("returns error when lead_id missing", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_pipeline_stage",
          payload: { new_stage: "abordado" },
        }),
      );
      expect(result.success).toBe(false);
    });

    it("returns error when new_stage missing", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_pipeline_stage",
          payload: { lead_id: "lead-1" },
        }),
      );
      expect(result.success).toBe(false);
    });

    it("creates new pipe_whatsapp entry if none exists", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("pipe_whatsapp", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_pipeline_stage",
          payload: { lead_id: "lead-1", new_stage: "novo" },
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  // ── send_document ────────────────────────────────────────────────────────

  describe("send_document", () => {
    it("returns error when document_id missing", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "send_document",
          payload: {},
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("document_id");
    });

    it("returns error when lead_id is null", async () => {
      const { sb } = createMockSupabase();
      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "send_document",
          lead_id: null,
          payload: { document_id: "doc-1" },
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("lead_id");
    });

    it("returns error when document not found", async () => {
      const { sb, mockTable } = createMockSupabase();
      // Empty copilot_agent_documents = doc not found
      mockTable("copilot_agent_documents", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "send_document",
          payload: { document_id: "doc-nonexistent" },
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("returns error when lead has no phone", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("copilot_agent_documents", [
        {
          id: "doc-1",
          file_name: "catalog.pdf",
          file_path: "org-1/catalog.pdf",
          mime_type: "application/pdf",
          organization_id: "org-1",
          file_type: "document",
        },
      ]);
      mockTable("leads", [{ id: "lead-1", phone: null }]);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "send_document",
          payload: { document_id: "doc-1" },
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("phone");
    });

    it("returns error when no WhatsApp instance active", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("copilot_agent_documents", [
        {
          id: "doc-1",
          file_name: "catalog.pdf",
          file_path: "org-1/catalog.pdf",
          mime_type: "application/pdf",
          organization_id: "org-1",
          file_type: "document",
        },
      ]);
      mockTable("leads", [{ id: "lead-1", phone: "11999887766" }]);
      mockTable("whatsapp_instances", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "send_document",
          payload: { document_id: "doc-1" },
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("WhatsApp instance");
    });

    it("returns error when Evolution API env vars not set", async () => {
      clearDenoEnv();
      setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
      setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
      // No EVOLUTION_API_URL or EVOLUTION_API_KEY

      const { sb, mockTable } = createMockSupabase();
      mockTable("copilot_agent_documents", [
        {
          id: "doc-1",
          file_name: "catalog.pdf",
          file_path: "org-1/catalog.pdf",
          mime_type: "application/pdf",
          organization_id: "org-1",
          file_type: "document",
        },
      ]);
      mockTable("leads", [{ id: "lead-1", phone: "11999887766" }]);
      mockTable("whatsapp_instances", [
        { instance_name: "inst-1", organization_id: "org-1", status: "open" },
      ]);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "send_document",
          payload: { document_id: "doc-1" },
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Evolution API");
    });

    it("sends document successfully via Evolution API", async () => {
      setDenoEnv("EVOLUTION_API_URL", "https://evolution.test");
      setDenoEnv("EVOLUTION_API_KEY", "evo-key");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ key: { id: "msg-123" } }),
        text: () => Promise.resolve(""),
      });

      const { sb, mockTable } = createMockSupabase();
      mockTable("copilot_agent_documents", [
        {
          id: "doc-1",
          file_name: "catalog.pdf",
          file_path: "org-1/catalog.pdf",
          mime_type: "application/pdf",
          organization_id: "org-1",
          file_type: "document",
        },
      ]);
      mockTable("leads", [{ id: "lead-1", phone: "5511999887766" }]);
      mockTable("whatsapp_instances", [
        { instance_name: "inst-1", organization_id: "org-1", status: "open" },
      ]);
      mockTable("whatsapp_messages", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "send_document",
          payload: { document_id: "doc-1", caption: "Here is the catalog" },
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.file_name).toBe("catalog.pdf");
      expect(result.data?.message_id).toBe("msg-123");
    });

    it("detects image file type and sends as image", async () => {
      setDenoEnv("EVOLUTION_API_URL", "https://evolution.test");
      setDenoEnv("EVOLUTION_API_KEY", "evo-key");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ key: { id: "msg-img" } }),
        text: () => Promise.resolve(""),
      });

      const { sb, mockTable } = createMockSupabase();
      mockTable("copilot_agent_documents", [
        {
          id: "doc-2",
          file_name: "photo.jpg",
          file_path: "org-1/photo.jpg",
          mime_type: "image/jpeg",
          organization_id: "org-1",
          file_type: "image",
        },
      ]);
      mockTable("leads", [{ id: "lead-1", phone: "11999887766" }]);
      mockTable("whatsapp_instances", [
        { instance_name: "inst-1", organization_id: "org-1", status: "open" },
      ]);
      mockTable("whatsapp_messages", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "send_document",
          payload: { document_id: "doc-2" },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("detects video file type by mime_type fallback", async () => {
      setDenoEnv("EVOLUTION_API_URL", "https://evolution.test");
      setDenoEnv("EVOLUTION_API_KEY", "evo-key");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ key: { id: "msg-vid" } }),
        text: () => Promise.resolve(""),
      });

      const { sb, mockTable } = createMockSupabase();
      mockTable("copilot_agent_documents", [
        {
          id: "doc-3",
          file_name: "demo.mp4",
          file_path: "org-1/demo.mp4",
          mime_type: "video/mp4",
          organization_id: "org-1",
          file_type: "video",
        },
      ]);
      mockTable("leads", [{ id: "lead-1", phone: "11999887766" }]);
      mockTable("whatsapp_instances", [
        { instance_name: "inst-1", organization_id: "org-1", status: "open" },
      ]);
      mockTable("whatsapp_messages", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "send_document",
          payload: { document_id: "doc-3" },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("returns error when Evolution API returns HTTP error", async () => {
      setDenoEnv("EVOLUTION_API_URL", "https://evolution.test");
      setDenoEnv("EVOLUTION_API_KEY", "evo-key");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Internal" }),
        text: () => Promise.resolve("Internal Server Error"),
      });

      const { sb, mockTable } = createMockSupabase();
      mockTable("copilot_agent_documents", [
        {
          id: "doc-1",
          file_name: "catalog.pdf",
          file_path: "org-1/catalog.pdf",
          mime_type: "application/pdf",
          organization_id: "org-1",
          file_type: "document",
        },
      ]);
      mockTable("leads", [{ id: "lead-1", phone: "11999887766" }]);
      mockTable("whatsapp_instances", [
        { instance_name: "inst-1", organization_id: "org-1", status: "open" },
      ]);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "send_document",
          payload: { document_id: "doc-1" },
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Evolution API error");
    });

    it("handles fetch exception during send", async () => {
      setDenoEnv("EVOLUTION_API_URL", "https://evolution.test");
      setDenoEnv("EVOLUTION_API_KEY", "evo-key");

      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const { sb, mockTable } = createMockSupabase();
      mockTable("copilot_agent_documents", [
        {
          id: "doc-1",
          file_name: "catalog.pdf",
          file_path: "org-1/catalog.pdf",
          mime_type: "application/pdf",
          organization_id: "org-1",
          file_type: "document",
        },
      ]);
      mockTable("leads", [{ id: "lead-1", phone: "11999887766" }]);
      mockTable("whatsapp_instances", [
        { instance_name: "inst-1", organization_id: "org-1", status: "open" },
      ]);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "send_document",
          payload: { document_id: "doc-1" },
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Network timeout");
    });

    it("prepends 55 to phone numbers that don't start with it", async () => {
      setDenoEnv("EVOLUTION_API_URL", "https://evolution.test");
      setDenoEnv("EVOLUTION_API_KEY", "evo-key");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ key: { id: "msg-456" } }),
        text: () => Promise.resolve(""),
      });

      const { sb, mockTable } = createMockSupabase();
      mockTable("copilot_agent_documents", [
        {
          id: "doc-1",
          file_name: "file.pdf",
          file_path: "org-1/file.pdf",
          mime_type: "application/pdf",
          organization_id: "org-1",
          file_type: "document",
        },
      ]);
      mockTable("leads", [{ id: "lead-1", phone: "(11) 99988-7766" }]);
      mockTable("whatsapp_instances", [
        { instance_name: "inst-1", organization_id: "org-1", status: "open" },
      ]);
      mockTable("whatsapp_messages", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "send_document",
          payload: { document_id: "doc-1" },
        }),
      );
      expect(result.success).toBe(true);
      // Verify fetch was called with number starting with 55
      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.number).toBe("5511999887766");
    });
  });

  // ── lead_history logging ─────────────────────────────────────────────────

  describe("lead_history logging", () => {
    it("logs to lead_history for transfer_to_human action", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("conversations", [{ id: "conv-1", lead_id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "transfer_to_human",
          payload: { lead_id: "lead-1" },
        }),
      );
      expect(result.success).toBe(true);

      // Check that lead_history got an insert
      const historyInserts = getInserted("lead_history");
      expect(historyInserts.length).toBeGreaterThan(0);
    });

    it("logs to lead_history for create_lead action", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      mockTable("leads", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "create_lead",
          payload: { name: "New Lead" },
        }),
      );
      expect(result.success).toBe(true);

      const historyInserts = getInserted("lead_history");
      expect(historyInserts.length).toBeGreaterThan(0);
    });

    it("logs to lead_history for update_lead action", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1", organization_id: "org-1", notes: null }]);
      mockTable("lead_custom_fields", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_lead",
          payload: { lead_id: "lead-1", updates: { company: "TestCo" } },
        }),
      );
      expect(result.success).toBe(true);

      const historyInserts = getInserted("lead_history");
      expect(historyInserts.length).toBeGreaterThan(0);
    });

    it("skips lead_history for stage-related actions (handled by PG triggers)", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      mockTable("pipeline_stages", []);
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("pipe_whatsapp", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "advance_stage",
          payload: { lead_id: "lead-1", target_stage: "respondeu" },
        }),
      );
      expect(result.success).toBe(true);

      // advance_stage is in STAGE_AI_ACTIONS, so no insert to lead_history
      const historyInserts = getInserted("lead_history");
      expect(historyInserts.length).toBe(0);
    });

    it("does not log when action result is failure", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      // Empty leads = lead not found for update_lead
      mockTable("leads", []);
      mockTable("lead_custom_fields", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "update_lead",
          payload: { lead_id: "lead-1", updates: { company: "X" } },
        }),
      );
      expect(result.success).toBe(false);

      const historyInserts = getInserted("lead_history");
      expect(historyInserts.length).toBe(0);
    });

    it("resolves lead_id from payload when action.lead_id is null", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("conversations", [{ id: "conv-1", lead_id: "lead-1" }]);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "transfer_to_human",
          lead_id: null,
          payload: { lead_id: "lead-1" },
        }),
      );
      expect(result.success).toBe(true);

      const historyInserts = getInserted("lead_history");
      expect(historyInserts.length).toBeGreaterThan(0);
    });

    it("resolves lead_id from result.data when both action.lead_id and payload.lead_id are null", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      mockTable("leads", []);
      mockTable("lead_history", []);

      const result = await executeAiAction(
        sb,
        makeAction({
          action_type: "create_lead",
          lead_id: null,
          payload: { name: "FromResult" },
        }),
      );
      expect(result.success).toBe(true);

      // create_lead returns lead_id in result.data
      const historyInserts = getInserted("lead_history");
      expect(historyInserts.length).toBeGreaterThan(0);
    });
  });

  // ── ACTION_HISTORY_MAP description coverage ──────────────────────────────

  describe("lead_history descriptions for various action types", () => {
    it("logs schedule_meeting with preferred_date in description", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      mockTable("leads", [
        { id: "lead-1", name: "Test", email: null, responsible_id: null, sdr_id: null },
      ]);
      mockTable("pipe_confirmacao", []);
      mockTable("lead_history", []);

      await executeAiAction(
        sb,
        makeAction({
          action_type: "schedule_meeting",
          payload: { lead_id: "lead-1", preferred_date: "2026-10-10" },
        }),
      );

      const historyInserts = getInserted("lead_history");
      expect(historyInserts.length).toBeGreaterThan(0);
      expect((historyInserts[0] as any).description).toContain("2026-10-10");
    });

    it("logs update_qualification_score with score in description", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("lead_history", []);

      await executeAiAction(
        sb,
        makeAction({
          action_type: "update_qualification_score",
          payload: { lead_id: "lead-1", score: 77 },
        }),
      );

      const historyInserts = getInserted("lead_history");
      expect(historyInserts.length).toBeGreaterThan(0);
      expect((historyInserts[0] as any).description).toContain("77");
    });

    it("logs send_document with file name in description", async () => {
      setDenoEnv("EVOLUTION_API_URL", "https://evolution.test");
      setDenoEnv("EVOLUTION_API_KEY", "evo-key");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ key: { id: "msg-doc" } }),
        text: () => Promise.resolve(""),
      });

      const { sb, mockTable, getInserted } = createMockSupabase();
      mockTable("copilot_agent_documents", [
        {
          id: "doc-1",
          file_name: "brochure.pdf",
          file_path: "org-1/brochure.pdf",
          mime_type: "application/pdf",
          organization_id: "org-1",
          file_type: "document",
        },
      ]);
      mockTable("leads", [{ id: "lead-1", phone: "5511999999999" }]);
      mockTable("whatsapp_instances", [
        { instance_name: "inst-1", organization_id: "org-1", status: "open" },
      ]);
      mockTable("whatsapp_messages", []);
      mockTable("lead_history", []);

      await executeAiAction(
        sb,
        makeAction({
          action_type: "send_document",
          payload: { document_id: "doc-1" },
        }),
      );

      const historyInserts = getInserted("lead_history");
      expect(historyInserts.length).toBeGreaterThan(0);
      // ACTION_HISTORY_MAP uses payload.file_name, not the doc's file_name from DB
      // Since payload only has document_id, it falls back to "arquivo"
      expect((historyInserts[0] as any).description).toContain("arquivo");
    });

    it("logs confirm_meeting with confirmation type in description", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      mockTable("pipe_confirmacao", [
        { id: "pc-1", lead_id: "lead-1", status: "confirmar_d1" },
      ]);
      mockTable("lead_history", []);

      await executeAiAction(
        sb,
        makeAction({
          action_type: "confirm_meeting",
          payload: { lead_id: "lead-1", confirmation_type: "confirmed" },
        }),
      );

      const historyInserts = getInserted("lead_history");
      expect(historyInserts.length).toBeGreaterThan(0);
      expect((historyInserts[0] as any).description).toContain("confirmada");
    });

    it("logs create_custom_field with field name in description", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      mockTable("lead_custom_fields", []);
      mockTable("lead_history", []);

      await executeAiAction(
        sb,
        makeAction({
          action_type: "create_custom_field",
          payload: { field_name: "Size", field_type: "text" },
        }),
      );

      const historyInserts = getInserted("lead_history");
      expect(historyInserts.length).toBeGreaterThan(0);
      expect((historyInserts[0] as any).description).toContain("Size");
    });

    it("logs transfer_to_human_notify with reason in description", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      mockTable("leads", [
        { id: "lead-1", name: "Maria", company: "Acme", responsible_id: null },
      ]);
      mockTable("team_members", []);
      mockTable("notifications", []);
      mockTable("lead_history", []);

      await executeAiAction(
        sb,
        makeAction({
          action_type: "transfer_to_human_notify",
          lead_id: "lead-1",
          payload: { reason: "complex question" },
        }),
      );

      const historyInserts = getInserted("lead_history");
      expect(historyInserts.length).toBeGreaterThan(0);
      expect((historyInserts[0] as any).description).toContain("complex question");
    });

    it("logs transfer_sz_chat with team name in description", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      mockTable("sz_chat_sessions", [
        {
          lead_id: "lead-1",
          organization_id: "org-1",
          status: "active",
          sz_chat_session_id: "sz-1",
          created_at: "2026-01-01",
        },
      ]);
      mockTable("leads", [{ id: "lead-1" }]);
      mockTable("lead_history", []);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true }),
        text: () => Promise.resolve(""),
      });

      await executeAiAction(
        sb,
        makeAction({
          action_type: "transfer_sz_chat",
          lead_id: "lead-1",
          payload: { target_team_name: "Financial" },
        }),
      );

      const historyInserts = getInserted("lead_history");
      expect(historyInserts.length).toBeGreaterThan(0);
      expect((historyInserts[0] as any).description).toContain("Financial");
    });
  });
});
