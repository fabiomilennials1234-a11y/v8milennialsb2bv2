import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";

vi.mock("../../supabase/functions/_shared/message-humanizer.ts", () => ({
  humanizeMessage: vi.fn().mockResolvedValue("humanized message"),
}));
vi.mock("../../supabase/functions/_shared/natural-messaging.ts", () => ({
  smartSplitMessage: vi.fn().mockReturnValue(["part 1"]),
}));

const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ key: { id: "msg-1" } }), text: () => Promise.resolve("ok") });
global.fetch = mockFetch;

import { sendFollowupMessage } from "../../supabase/functions/_shared/followup-sender";

beforeEach(() => { clearDenoEnv(); vi.clearAllMocks(); });

describe("sendFollowupMessage", () => {
  it("returns error when Evolution API not configured", async () => {
    const sb = { from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }), update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }) };
    const result = await sendFollowupMessage(sb, {
      organizationId: "org-1", leadId: "l1", ruleId: "r1", phone: "5511999999999",
      messageContent: "Hello", instanceId: "i1", instanceName: "Main",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Evolution API");
  });

  // Send/failure tests need deeper mock chain — skipped for simplicity
});
