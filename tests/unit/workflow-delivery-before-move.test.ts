import { describe, expect, it } from "vitest";
import "../helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";
import { executeWorkflowAction } from "../../supabase/functions/_shared/workflow-action-handler";

const org = "org-a", exec = "execution-a";
async function run(status: string, patch: Record<string, unknown> = {}) {
  const mock = createMockSupabase();
  mock.mockTable("channel_messages", [{ id: "message-a", organization_id: org, direction: "outgoing", channel: "whatsapp", status,
    metadata: { origem: { id: exec, source: "workflow-action-template" } }, created_at: new Date().toISOString(), ...patch }]);
  mock.mockTable("upsell_clients", [{ id: "client-a", lead_id: "lead-a" }]);
  const result = await executeWorkflowAction({ supabase: mock.sb, organizationId: org, leadId: "lead-a", executionId: exec,
    executionContext: {}, nodeData: { actionType: "move_stage", pipeType: "upsell_base", targetStage: "ativo", awaitDeliveryConfirmation: true } });
  return { result, writes: mock.getUpdated("upsell_clients") };
}
describe("workflow movement after official delivery", () => {
  it.each(["pending", "queued", "sent"])("keeps the deal still while %s; defers without resending", async (status) => {
    const { result, writes } = await run(status);
    expect(result.success).toBe(false);
    expect(Date.parse(result.retryAt!)).toBeGreaterThan(Date.now());
    expect(writes).toHaveLength(0);
  });
  it("keeps the deal still on provider rejection without retrying the send", async () => {
    const { result, writes } = await run("failed");
    expect(result).toMatchObject({ success: false, retryable: false });
    expect(writes).toHaveLength(0);
  });
  it.each(["delivered", "read"])("moves only after %s", async (status) => {
    const { result, writes } = await run(status);
    expect(result.success).toBe(true);
    expect(writes).toHaveLength(1);
  });
  it("expires missing delivery without changing the deal", async () => {
    const { result, writes } = await run("sent", { created_at: "2020-01-01T00:00:00Z" });
    expect(result).toMatchObject({ success: false, retryable: false });
    expect(writes).toHaveLength(0);
  });
  it.each([
    { organization_id: "org-b" },
    { metadata: { origem: { id: "other-execution", source: "workflow-action-template" } } },
    { channel: "instagram" },
  ])("refuses movement without same-tenant/execution/channel evidence %j", async (patch) => {
    const { result, writes } = await run("delivered", patch);
    expect(result).toMatchObject({ success: false, retryable: false });
    expect(writes).toHaveLength(0);
  });
});
