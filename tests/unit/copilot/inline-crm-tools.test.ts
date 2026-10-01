import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), transfer: vi.fn(), queue: vi.fn() }));
vi.mock("../../../supabase/functions/_shared/ai-action-executor.ts", () => ({ executeAiAction: mocks.execute, immediateTransferHuman: mocks.transfer }));
vi.mock("../../../supabase/functions/_shared/ai-queue.ts", () => ({ enqueueAiAction: mocks.queue }));
vi.mock("../../../supabase/functions/_shared/logger.ts", () => ({ logRuntime: vi.fn(async () => {}) }));
import { runInlineCrmTools } from "../../../supabase/functions/agent-message/engine/inline-crm-tools.ts";

const call = (name: string, args = {}) => ({ id: name, function: { name, arguments: JSON.stringify(args) } });
const input = () => {
  const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: { ai_disabled_at: new Date().toISOString() }, error: null }) };
  return { supabase: { from: () => chain } as never, organizationId: "org", leadId: "lead", conversationId: "conv", availableTools: ["update_lead", "advance_stage", "transfer_to_human"], calls: [call("update_lead", { updates: { company: "Test" } }), call("advance_stage"), call("transfer_to_human")] };
};
beforeEach(() => { vi.clearAllMocks(); mocks.execute.mockResolvedValue({ success: true }); mocks.transfer.mockResolvedValue({ success: true }); mocks.queue.mockResolvedValue({ queued: true }); });
describe("ordered CRM tools", () => {
  it("stops before moving or handing off when the write fails", async () => {
    mocks.execute.mockResolvedValueOnce({ success: false, error: "write failed" });
    const result = await runInlineCrmTools(input());
    expect(result.failed).toBe(true);
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.transfer).not.toHaveBeenCalled();
    expect(result.receipt).toBeUndefined();
  });
  it("stops before handing off when the move fails", async () => {
    mocks.execute.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, error: "stage unavailable" });
    expect((await runInlineCrmTools(input())).failed).toBe(true);
    expect(mocks.transfer).not.toHaveBeenCalled();
  });
  it("rejects unavailable tools and ignores a supplied lead id", async () => {
    const request = input(); request.availableTools = ["update_lead"];
    request.calls[0] = call("update_lead", { lead_id: "another-tenant", updates: { company: "Test" } });
    const result = await runInlineCrmTools(request);
    expect(mocks.execute.mock.calls[0][1].payload.lead_id).toBe("lead");
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(result.failed).toBe(true);
    expect(mocks.transfer).not.toHaveBeenCalled();
  });
  it("supports an immediate request for a human without requiring registration", async () => {
    const result = await runInlineCrmTools({ ...input(), calls: [call("transfer_to_human", { reason: "Cliente pediu humano" })] });
    expect(result.handedOff).toBe(true); expect(result.failed).toBe(false);
    expect(mocks.queue).toHaveBeenCalledOnce();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("does not report a failed transfer as complete", async () => {
    mocks.transfer.mockResolvedValueOnce({ success: false, error: "rpc failed" });
    const result = await runInlineCrmTools(input());
    expect(result.handedOff).toBe(false); expect(result.receipt).toBeUndefined();
    expect(result.failed).toBe(true); expect(mocks.queue).not.toHaveBeenCalled();
  });
});
