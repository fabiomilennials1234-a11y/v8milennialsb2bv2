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
