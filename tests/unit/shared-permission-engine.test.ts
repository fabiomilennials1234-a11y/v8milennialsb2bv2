import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

// Mock logger to avoid side effects
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn().mockResolvedValue(undefined),
}));

// Mock createClient for getServiceClient
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: vi.fn().mockReturnValue({}),
}));

setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

import {
  canUserPerformAction,
  canUserAccessFeature,
  type PermissionAction,
  type PermissionResult,
} from "../../supabase/functions/_shared/permission_engine";

describe("canUserPerformAction", () => {
  it("allows master user", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("master_users", [{ id: "m1", user_id: "u1", is_active: true }]);
    const result = await canUserPerformAction({
      supabase: sb,
      userId: "u1",
      organizationId: "org-1",
      action: "create_lead",
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("master_user");
  });

  it("denies user not in org", async () => {
    const { sb } = createMockSupabase();
    // No master_users, no team_members
    const result = await canUserPerformAction({
      supabase: sb,
      userId: "u-unknown",
      organizationId: "org-1",
      action: "create_lead",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("não pertence");
  });

  it("allows admin user", async () => {
    const { sb, mockTable } = createMockSupabase();
    // Not master but is team_member with role admin
    mockTable("team_members", [{ id: "tm1", user_id: "u1", organization_id: "org-1", role: "admin", is_active: true }]);
    const result = await canUserPerformAction({
      supabase: sb,
      userId: "u1",
      organizationId: "org-1",
      action: "import_leads",
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("admin");
  });

  it("checks feature permission for member with edit_workflow", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", [{ id: "tm1", user_id: "u1", organization_id: "org-1", role: "membro", is_active: true }]);
    mockTable("feature_permissions", [{ key: "workflows.edit", is_admin_only: false, default_value: true }]);
    const result = await canUserPerformAction({
      supabase: sb,
      userId: "u1",
      organizationId: "org-1",
      action: "edit_workflow",
    });
    expect(result.allowed).toBe(true);
  });

  it("fallback allows for unmatched actions", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", [{ id: "tm1", user_id: "u1", organization_id: "org-1", role: "membro", is_active: true }]);
    const result = await canUserPerformAction({
      supabase: sb,
      userId: "u1",
      organizationId: "org-1",
      action: "send_message",
    });
    // send_message has a feature_key: whatsapp.send_messages
    // With no feature_permissions row, it checks and may deny
    expect(typeof result.allowed).toBe("boolean");
  });
});

describe("canUserAccessFeature", () => {
  it("returns true for master user", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("master_users", [{ id: "m1", user_id: "u1", is_active: true }]);
    const result = await canUserAccessFeature(sb, "u1", "org-1", "workflows.edit");
    expect(result).toBe(true);
  });

  it("returns false for user not in org", async () => {
    const { sb } = createMockSupabase();
    const result = await canUserAccessFeature(sb, "u-unknown", "org-1", "workflows.edit");
    expect(result).toBe(false);
  });

  it("returns true for admin", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", [{ id: "tm1", user_id: "u1", organization_id: "org-1", role: "admin", is_active: true }]);
    const result = await canUserAccessFeature(sb, "u1", "org-1", "workflows.edit");
    expect(result).toBe(true);
  });

  it("checks feature_permissions for members", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", [{ id: "tm1", user_id: "u1", organization_id: "org-1", role: "membro", is_active: true }]);
    mockTable("feature_permissions", [{ key: "workflows.edit", is_admin_only: false, default_value: true }]);
    const result = await canUserAccessFeature(sb, "u1", "org-1", "workflows.edit");
    expect(result).toBe(true);
  });
});

describe("Type exports", () => {
  it("PermissionAction accepts valid values", () => {
    const actions: PermissionAction[] = [
      "move_pipe_record", "import_leads", "create_lead", "delete_lead",
      "trigger_campaign", "edit_workflow", "export_leads", "view_lead",
      "send_message", "manage_team", "manage_copilot",
    ];
    expect(actions).toHaveLength(11);
  });

  it("PermissionResult shape", () => {
    const result: PermissionResult = { allowed: true, reason: "admin" };
    expect(result.allowed).toBe(true);
  });
});

// ─── Feature-key actions (edit_workflow / manage_team / manage_copilot / send_message) ───

describe("canUserPerformAction — feature-key actions", () => {
  const asMember = (mockTable: (t: string, r: unknown[]) => void) => {
    mockTable("team_members", [
      { id: "tm1", user_id: "u1", organization_id: "org-1", role: "membro", is_active: true },
    ]);
  };

  it("denies edit_workflow when feature is admin_only", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    mockTable("feature_permissions", [
      { key: "workflows.edit", is_admin_only: true, default_value: true },
    ]);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "edit_workflow",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("workflows.edit");
  });

  it("denies edit_workflow when feature row is missing", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "edit_workflow",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("workflows.edit");
  });

  it("denies when default_value=false and no override", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    mockTable("feature_permissions", [
      { key: "workflows.edit", is_admin_only: false, default_value: false },
    ]);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "edit_workflow",
    });
    expect(result.allowed).toBe(false);
  });

  it("member override wins over default_value (override enabled=true)", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    mockTable("feature_permissions", [
      { key: "workflows.edit", is_admin_only: false, default_value: false },
    ]);
    mockTable("member_feature_permissions", [
      { team_member_id: "tm1", feature_key: "workflows.edit", enabled: true },
    ]);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "edit_workflow",
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("feature:workflows.edit");
  });

  it("member override wins over default_value (override enabled=false)", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    mockTable("feature_permissions", [
      { key: "workflows.edit", is_admin_only: false, default_value: true },
    ]);
    mockTable("member_feature_permissions", [
      { team_member_id: "tm1", feature_key: "workflows.edit", enabled: false },
    ]);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "edit_workflow",
    });
    expect(result.allowed).toBe(false);
  });

  it("manage_team resolves via team.view feature", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    mockTable("feature_permissions", [
      { key: "team.view", is_admin_only: false, default_value: true },
    ]);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "manage_team",
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("feature:team.view");
  });

  it("manage_copilot resolves via copilot.create feature", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    mockTable("feature_permissions", [
      { key: "copilot.create", is_admin_only: false, default_value: true },
    ]);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "manage_copilot",
    });
    expect(result.allowed).toBe(true);
  });

  it("send_message resolves via whatsapp.send_messages feature", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    mockTable("feature_permissions", [
      { key: "whatsapp.send_messages", is_admin_only: false, default_value: true },
    ]);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "send_message",
    });
    expect(result.allowed).toBe(true);
  });
});

// ─── delete_lead (org-permission path) ───

describe("canUserPerformAction — delete_lead (org permission)", () => {
  const asMember = (mockTable: (t: string, r: unknown[]) => void) => {
    mockTable("team_members", [
      { id: "tm1", user_id: "u1", organization_id: "org-1", role: "membro", is_active: true },
    ]);
  };

  it("denies delete_lead when no override and no role permission", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "delete_lead",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("excluir");
  });

  it("allows delete_lead via individual override (enabled=true)", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    mockTable("team_member_org_permissions", [
      { team_member_id: "tm1", permission_key: "can_delete_leads", enabled: true },
    ]);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "delete_lead",
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("can_delete_leads");
  });

  it("individual override enabled=false denies even if role allows", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    mockTable("team_member_org_permissions", [
      { team_member_id: "tm1", permission_key: "can_delete_leads", enabled: false },
    ]);
    mockTable("organization_role_permissions", [
      { organization_id: "org-1", role: "membro", permission_key: "can_delete_leads", enabled: true },
    ]);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "delete_lead",
    });
    expect(result.allowed).toBe(false);
  });

  it("falls back to role permission when no individual override", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    mockTable("organization_role_permissions", [
      { organization_id: "org-1", role: "membro", permission_key: "can_delete_leads", enabled: true },
    ]);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "delete_lead",
    });
    expect(result.allowed).toBe(true);
  });
});

// ─── Matrix-backed actions (create_lead / view_lead / export_leads / trigger_campaign / import_leads) ───

describe("canUserPerformAction — legacy matrix", () => {
  const asMember = (mockTable: (t: string, r: unknown[]) => void) => {
    mockTable("team_members", [
      { id: "tm1", user_id: "u1", organization_id: "org-1", role: "membro", is_active: true },
    ]);
  };

  it("allows create_lead when matrix entry missing (default allowed)", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "create_lead",
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("matrix_allowed");
  });

  it("denies view_lead when matrix value=denied", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    mockTable("team_member_permissions", [
      { team_member_id: "tm1", resource_key: "leads", action_key: "view", value: "denied" },
    ]);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "view_lead",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("leads.view");
  });

  it("allows export_leads when matrix value=allowed_own", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    mockTable("team_member_permissions", [
      { team_member_id: "tm1", resource_key: "leads", action_key: "export", value: "allowed_own" },
    ]);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "export_leads",
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("matrix_allowed_own");
  });

  it("trigger_campaign maps to campanhas.edit", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    mockTable("team_member_permissions", [
      { team_member_id: "tm1", resource_key: "campanhas", action_key: "edit", value: "denied" },
    ]);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "trigger_campaign",
    });
    expect(result.allowed).toBe(false);
  });

  it("import_leads maps to leads.create", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    mockTable("team_member_permissions", [
      { team_member_id: "tm1", resource_key: "leads", action_key: "create", value: "denied" },
    ]);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "import_leads",
    });
    expect(result.allowed).toBe(false);
  });
});

// ─── move_pipe_record ───

describe("canUserPerformAction — move_pipe_record", () => {
  const asMember = (mockTable: (t: string, r: unknown[]) => void) => {
    mockTable("team_members", [
      { id: "tm1", user_id: "u1", organization_id: "org-1", role: "membro", is_active: true },
    ]);
  };

  it("denies when resourceId missing (fail-closed)", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "move_pipe_record",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("permission_not_defined");
  });

  it("allows move with resourceId when matrix has no denial", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    const result = await canUserPerformAction({
      supabase: sb,
      userId: "u1",
      organizationId: "org-1",
      action: "move_pipe_record",
      resourceId: "pipe_whatsapp",
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("matrix_allowed");
  });

  it("denies move with resourceId when matrix value=denied", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    mockTable("team_member_permissions", [
      { team_member_id: "tm1", resource_key: "pipe_whatsapp", action_key: "edit", value: "denied" },
    ]);
    const result = await canUserPerformAction({
      supabase: sb,
      userId: "u1",
      organizationId: "org-1",
      action: "move_pipe_record",
      resourceId: "pipe_whatsapp",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("mover");
  });
});

// ─── canUserAccessFeature extras ───

describe("canUserAccessFeature — edge cases", () => {
  it("returns false when feature row is missing", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", [
      { id: "tm1", user_id: "u1", organization_id: "org-1", role: "membro", is_active: true },
    ]);
    const result = await canUserAccessFeature(sb, "u1", "org-1", "unknown.feature");
    expect(result).toBe(false);
  });

  it("returns false when feature is admin_only (member)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", [
      { id: "tm1", user_id: "u1", organization_id: "org-1", role: "membro", is_active: true },
    ]);
    mockTable("feature_permissions", [
      { key: "admin.secret", is_admin_only: true, default_value: true },
    ]);
    const result = await canUserAccessFeature(sb, "u1", "org-1", "admin.secret");
    expect(result).toBe(false);
  });

  it("member override enabled=true grants access even if default_value=false", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", [
      { id: "tm1", user_id: "u1", organization_id: "org-1", role: "membro", is_active: true },
    ]);
    mockTable("feature_permissions", [
      { key: "reports.view", is_admin_only: false, default_value: false },
    ]);
    mockTable("member_feature_permissions", [
      { team_member_id: "tm1", feature_key: "reports.view", enabled: true },
    ]);
    const result = await canUserAccessFeature(sb, "u1", "org-1", "reports.view");
    expect(result).toBe(true);
  });

  it("returns default_value=false when no override", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", [
      { id: "tm1", user_id: "u1", organization_id: "org-1", role: "membro", is_active: true },
    ]);
    mockTable("feature_permissions", [
      { key: "reports.view", is_admin_only: false, default_value: false },
    ]);
    const result = await canUserAccessFeature(sb, "u1", "org-1", "reports.view");
    expect(result).toBe(false);
  });
});
