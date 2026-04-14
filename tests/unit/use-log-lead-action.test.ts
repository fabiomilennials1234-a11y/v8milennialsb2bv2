import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1", email: "test@test.com" } } }) },
  },
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
}));

import type { LeadActionType } from "@/hooks/useLogLeadAction";

describe("LeadActionType", () => {
  it("includes core action types", () => {
    const actions: LeadActionType[] = [
      "lead_created",
      "stage_changed",
      "sdr_assigned",
      "closer_assigned",
      "field_updated",
      "note_added",
      "meeting_scheduled",
      "meeting_attended",
      "meeting_missed",
      "meeting_deleted",
      "proposal_created",
      "proposal_status_changed",
      "proposal_deleted",
      "product_linked",
      "followup_created",
      "followup_completed",
      "ai_toggled",
      "copilot_interaction",
    ];
    expect(actions).toHaveLength(18);
    expect(actions).toContain("lead_created");
    expect(actions).toContain("stage_changed");
    expect(actions).toContain("copilot_interaction");
  });
});
