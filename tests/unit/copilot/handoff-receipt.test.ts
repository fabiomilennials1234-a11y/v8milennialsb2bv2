import { describe, expect, it } from "vitest";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";
import { canDeliverHandoffAck } from "../../../supabase/functions/_shared/copilot/handoff-receipt.ts";

function setup(prefOverride = {}, leadOverride = {}) {
  const { sb, mockTable } = createMockSupabase();
  const at = new Date().toISOString();
  mockTable("conversations", [{ id: "conv", lead_id: "lead", organization_id: "org", state: "WAITING_HUMAN" }]);
  mockTable("leads", [{ id: "lead", organization_id: "org", normalized_phone: "51999540202", ai_disabled: true, ai_disabled_at: at, ...leadOverride }]);
  mockTable("phone_ai_preferences", [{ organization_id: "org", normalized_phone: "51999540202", ai_disabled: true, set_at: at, human_paused_until: null, ...prefOverride }]);
  return { sb, receipt: { conversation_id: "conv", paused_at: at } };
}
describe("current handoff acknowledgement", () => {
  it("permits the acknowledgement of the current paused conversation", async () => {
    const { sb, receipt } = setup();
    expect(await canDeliverHandoffAck(sb, "org", "+55 51 99954-0202", receipt)).toBe(true);
  });
  it.each([
    { set_at: new Date(Date.now() + 30_000).toISOString() },
    { human_paused_until: new Date(Date.now() + 60_000).toISOString() },
    { ai_disabled: false },
  ])("respects a subsequent human change: %j", async override => {
    const { sb, receipt } = setup(override);
    expect(await canDeliverHandoffAck(sb, "org", "5551999540202", receipt)).toBe(false);
  });
  it("rejects another organization, number, or expired receipt", async () => {
    const { sb, receipt } = setup();
    expect(await canDeliverHandoffAck(sb, "other-org", "5551999540202", receipt)).toBe(false);
    expect(await canDeliverHandoffAck(sb, "org", "5511999999999", receipt)).toBe(false);
    expect(await canDeliverHandoffAck(sb, "org", "5551999540202", { ...receipt, paused_at: new Date(Date.now() - 121_000).toISOString() })).toBe(false);
  });
});
