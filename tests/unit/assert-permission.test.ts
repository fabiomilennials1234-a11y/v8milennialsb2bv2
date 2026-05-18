// @vitest-environment node
/**
 * Unit tests for assert-permission.ts — thin wrapper around permission_engine
 * for edge function use. TDD: red-green-refactor.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

// Mock logger to avoid side effects
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn().mockResolvedValue(undefined),
}));

// Mock createClient for getServiceClient fallback
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: vi.fn().mockReturnValue({}),
}));

setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

import {
  assertPermission,
  permissionDeniedResponse,
} from "../../supabase/functions/_shared/assert-permission";

describe("assertPermission", () => {
  it("returns { allowed: true } for admin user", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", [
      { id: "tm1", user_id: "u-admin", organization_id: "org-1", role: "admin", is_active: true },
    ]);

    const result = await assertPermission(sb, "u-admin", "org-1", "create_lead");

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("admin");
  });

  it("returns { allowed: true } for master user", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("master_users", [
      { id: "m1", user_id: "u-master", is_active: true },
    ]);

    const result = await assertPermission(sb, "u-master", "org-1", "delete_lead");

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("master_user");
  });

  it("returns { allowed: false, reason } for member without permission", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", [
      { id: "tm1", user_id: "u-member", organization_id: "org-1", role: "membro", is_active: true },
    ]);
    // delete_lead uses org-permission path — no overrides = denied
    const result = await assertPermission(sb, "u-member", "org-1", "delete_lead");

    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(typeof result.reason).toBe("string");
    expect(result.reason!.length).toBeGreaterThan(0);
  });

  it("returns { allowed: true } when matrix has no row (backwards compat default)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", [
      { id: "tm1", user_id: "u-member", organization_id: "org-1", role: "membro", is_active: true },
    ]);
    // create_lead uses legacy matrix — no row = default allowed
    const result = await assertPermission(sb, "u-member", "org-1", "create_lead");

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("matrix_allowed");
  });

  it("passes resourceId to permission engine", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", [
      { id: "tm1", user_id: "u-member", organization_id: "org-1", role: "membro", is_active: true },
    ]);
    mockTable("team_member_permissions", [
      { team_member_id: "tm1", resource_key: "pipe_whatsapp", action_key: "edit", value: "denied" },
    ]);

    const result = await assertPermission(sb, "u-member", "org-1", "move_pipe_record", "pipe_whatsapp");

    expect(result.allowed).toBe(false);
  });
});

describe("permissionDeniedResponse", () => {
  it("returns Response with status 403", () => {
    const response = permissionDeniedResponse("test reason", { "Content-Type": "application/json" });

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(403);
  });

  it("body contains JSON with error and reason", async () => {
    const response = permissionDeniedResponse("not allowed", { "Content-Type": "application/json" });
    const body = await response.json();

    expect(body.error).toBe("Permission denied");
    expect(body.reason).toBe("not allowed");
  });

  it("preserves custom headers", () => {
    const headers = {
      "Content-Type": "application/json",
      "X-Custom": "value",
    };
    const response = permissionDeniedResponse("denied", headers);

    expect(response.headers.get("X-Custom")).toBe("value");
  });
});
