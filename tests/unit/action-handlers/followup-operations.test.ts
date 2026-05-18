// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createMockSupabase } from "../../helpers/supabase-mock";
import type { ActionInput } from "../../../supabase/functions/_shared/action-handlers/types";
import { createFollowup } from "../../../supabase/functions/_shared/action-handlers/followup-operations";

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

describe("createFollowup", () => {
  it("creates follow-up with responsible from lead", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [
      { id: "lead-1", responsible_id: "resp-1", sdr_id: "sdr-1", closer_id: null },
    ]);

    const result = await createFollowup({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {
        followupTitle: "Retornar contato",
        followupDescription: "Lead pediu retorno",
        followupPriority: "high",
      },
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Retornar contato");

    const followups = getInserted("follow_ups");
    expect(followups.length).toBe(1);
    expect(followups[0]).toMatchObject({
      lead_id: "lead-1",
      assigned_to: "resp-1",
      title: "Retornar contato",
      description: "Lead pediu retorno",
      priority: "high",
      is_automated: true,
      organization_id: "org-1",
    });
    expect(followups[0].due_date).toBeDefined();
  });

  it("falls back to sdr_id when no responsible_id", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [
      { id: "lead-1", responsible_id: null, sdr_id: "sdr-1", closer_id: null },
    ]);

    const result = await createFollowup({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { followupTitle: "Test" },
    });

    expect(result.success).toBe(true);
    expect(getInserted("follow_ups")[0].assigned_to).toBe("sdr-1");
  });

  it("uses defaults for missing title/description/priority", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", responsible_id: null, sdr_id: null, closer_id: null }]);

    const result = await createFollowup({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {},
    });

    expect(result.success).toBe(true);
    const row = getInserted("follow_ups")[0];
    expect(row.title).toBe("Follow-up");
    expect(row.priority).toBe("normal");
    expect(row.assigned_to).toBeNull();
  });
});
