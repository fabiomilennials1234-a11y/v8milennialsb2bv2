/**
 * TDD tests for copilot tool-call-logger.
 * Fire-and-forget logger: inserts to agent_tool_call_logs, never throws.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// We'll import from the module under test once it exists
import { logToolCall } from "../../supabase/functions/_shared/copilot/tool-call-logger.ts";

function createMockSupabase(insertResult: { error: unknown } = { error: null }) {
  const insertFn = vi.fn().mockResolvedValue(insertResult);
  const fromFn = vi.fn().mockReturnValue({ insert: insertFn });
  return {
    client: { from: fromFn } as unknown,
    fromFn,
    insertFn,
  };
}

describe("logToolCall", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls supabase.from('agent_tool_call_logs').insert() with correct fields", async () => {
    const { client, fromFn, insertFn } = createMockSupabase();

    await logToolCall(client as any, {
      conversationId: "conv-1",
      organizationId: "org-1",
      agentId: "agent-1",
      toolName: "schedule_meeting",
      toolInput: { date: "2026-05-18" },
      toolOutputSummary: { success: true },
      durationMs: 150,
    });

    expect(fromFn).toHaveBeenCalledWith("agent_tool_call_logs");
    expect(insertFn).toHaveBeenCalledWith({
      conversation_id: "conv-1",
      organization_id: "org-1",
      agent_id: "agent-1",
      tool_name: "schedule_meeting",
      tool_input: { date: "2026-05-18" },
      tool_output_summary: { success: true },
      duration_ms: 150,
    });
  });

  it("catches errors without throwing (fire-and-forget)", async () => {
    const { client } = createMockSupabase({
      error: { message: "DB down", code: "500" },
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Must NOT throw
    await expect(
      logToolCall(client as any, {
        conversationId: "conv-2",
        organizationId: "org-2",
        toolName: "update_lead",
        toolInput: { name: "Test" },
      }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
  });

  it("includes duration_ms when provided", async () => {
    const { client, insertFn } = createMockSupabase();

    await logToolCall(client as any, {
      conversationId: "conv-3",
      organizationId: "org-3",
      toolName: "qualify_lead",
      toolInput: {},
      durationMs: 42,
    });

    const inserted = insertFn.mock.calls[0][0];
    expect(inserted.duration_ms).toBe(42);
  });

  it("omits optional fields when not provided", async () => {
    const { client, insertFn } = createMockSupabase();

    await logToolCall(client as any, {
      conversationId: "conv-4",
      organizationId: "org-4",
      toolName: "transfer_human",
      toolInput: {},
    });

    const inserted = insertFn.mock.calls[0][0];
    expect(inserted.agent_id).toBeUndefined();
    expect(inserted.tool_output_summary).toBeUndefined();
    expect(inserted.duration_ms).toBeUndefined();
  });
});
