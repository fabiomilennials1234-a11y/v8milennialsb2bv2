// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createMockSupabase } from "../../helpers/supabase-mock";
import type { ActionInput } from "../../../supabase/functions/_shared/action-handlers/types";
import {
  assignResponsible,
  assignSdr,
  assignCloser,
  notifyTeamMember,
} from "../../../supabase/functions/_shared/action-handlers/team-operations";

function makeInput(params: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}): ActionInput {
  const { sb } = createMockSupabase();
  return {
    supabase: sb,
    organizationId: "org-1",
    leadId: "lead-1",
    conversationId: null,
    params,
    ...overrides,
  };
}

// ─── assignResponsible ─────────────────────────────────────────────────────

describe("assignResponsible", () => {
  it("fails when no assigneeId and no round_robin", async () => {
    const result = await assignResponsible(makeInput({}));
    expect(result.success).toBe(false);
    expect(result.error).toContain("No team member");
  });

  it("assigns specific member when assigneeId provided", async () => {
    const result = await assignResponsible(makeInput({
      assigneeId: "member-1",
      assignMode: "specific",
    }));

    expect(result.success).toBe(true);
    expect(result.data?.assigneeId).toBe("member-1");
  });

  it("round_robin picks least-loaded member", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", [
      { id: "m1", organization_id: "org-1", is_active: true },
      { id: "m2", organization_id: "org-1", is_active: true },
    ]);
    mockTable("leads", [
      { id: "l1", responsible_id: "m1", organization_id: "org-1" },
    ]);

    const result = await assignResponsible({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { assignMode: "round_robin" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.assigneeId).toBeDefined();
  });
});

// ─── assignSdr / assignCloser ───────────────────────────────────────────────

describe("assignSdr", () => {
  it("fails when no assigneeId provided", async () => {
    const result = await assignSdr(makeInput({}));
    expect(result.success).toBe(false);
  });

  it("assigns specific SDR", async () => {
    const result = await assignSdr(makeInput({
      assigneeId: "sdr-1",
    }));

    expect(result.success).toBe(true);
    expect(result.data?.role).toBe("sdr");
  });

  it("round_robin with campaign uses RPC", async () => {
    const { sb, mockRpc } = createMockSupabase();
    mockRpc("get_next_campaign_sdr", "sdr-rr");

    const result = await assignSdr({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { assignMode: "round_robin", campaignId: "camp-1" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.assigneeId).toBe("sdr-rr");
  });

  it("round_robin with pipeType uses pipe RPC", async () => {
    const { sb, mockRpc } = createMockSupabase();
    mockRpc("get_next_pipe_sdr", "sdr-pipe");

    const result = await assignSdr({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { assignMode: "round_robin", pipeType: "whatsapp" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.assigneeId).toBe("sdr-pipe");
  });
});

describe("assignCloser", () => {
  it("assigns specific closer", async () => {
    const result = await assignCloser(makeInput({
      assigneeId: "closer-1",
    }));

    expect(result.success).toBe(true);
    expect(result.data?.role).toBe("closer");
  });

  it("round_robin with campaign uses closer RPC", async () => {
    const { sb, mockRpc } = createMockSupabase();
    mockRpc("get_next_campaign_closer", "closer-rr");

    const result = await assignCloser({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { assignMode: "round_robin", campaignId: "camp-1" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.assigneeId).toBe("closer-rr");
  });
});

// ─── notifyTeamMember ───────────────────────────────────────────────────────

describe("notifyTeamMember", () => {
  it("fails when memberId missing", async () => {
    const result = await notifyTeamMember(makeInput({}));
    expect(result.success).toBe(false);
    expect(result.error).toContain("No team member");
  });

  it("fails when member not found", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", []);

    const result = await notifyTeamMember({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { notifyMemberId: "nonexistent" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("inserts notification when member found", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("team_members", [
      { id: "tm-1", user_id: "user-1", name: "Carlos" },
    ]);

    const result = await notifyTeamMember({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {
        notifyMemberId: "tm-1",
        notifyMessage: "Lead precisa de atencao",
      },
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Carlos");

    const notifications = getInserted("notifications");
    expect(notifications.length).toBe(1);
    expect(notifications[0]).toMatchObject({
      organization_id: "org-1",
      user_id: "user-1",
      type: "workflow_notification",
      lead_id: "lead-1",
    });
  });
});
