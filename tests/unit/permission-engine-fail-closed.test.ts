// @vitest-environment node
/**
 * ISSUE #647 — permission_engine fail-closed.
 *
 * The permission engine must DENY by default. An unmatched / unknown
 * permission resolution (no explicit grant) must resolve to
 * { allowed: false } with a logged deny reason for audit — never to a
 * permissive fallback.
 *
 * Concretely, the legacy matrix path (checkMatrixPermission) used to default
 * a MISSING row to "allowed" (fail-OPEN). The only action still routed through
 * the matrix is `import_leads` → leads.create. With no matrix row configured,
 * the engine must now fail-closed.
 *
 * Known-allowed (explicit value="allowed") and known-denied (explicit
 * value="denied") rows must keep behaving correctly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

// Capture deny-log calls to assert a structured reason is emitted for audit.
const logRuntime = vi.fn().mockResolvedValue(undefined);
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: (...args: unknown[]) => logRuntime(...args),
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: vi.fn().mockReturnValue({}),
}));

setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

import { canUserPerformAction } from "../../supabase/functions/_shared/permission_engine";

const asMember = (mockTable: (t: string, r: unknown[]) => void) => {
  mockTable("team_members", [
    { id: "tm1", user_id: "u1", organization_id: "org-1", role: "member", is_active: true },
  ]);
};

beforeEach(() => {
  logRuntime.mockClear();
});

describe("canUserPerformAction — matrix path fail-closed (#647)", () => {
  it("DENIES import_leads when matrix has no row (missing grant fail-closed)", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    // No team_member_permissions row at all → previously defaulted to "allowed".
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "import_leads",
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(typeof result.reason).toBe("string");
    expect(result.reason!.length).toBeGreaterThan(0);
  });

  it("logs a structured deny reason for audit when matrix grant is missing", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "import_leads",
    });

    expect(logRuntime).toHaveBeenCalled();
    const call = logRuntime.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(call.module).toBe("permission");
    expect(call.status).toBe("error");
    expect(call.action).toContain("import_leads");
    expect(typeof call.errorMessage).toBe("string");
    expect((call.errorMessage as string).length).toBeGreaterThan(0);
  });

  it("ALLOWS import_leads when matrix has explicit value=allowed (known-allowed preserved)", async () => {
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    mockTable("team_member_permissions", [
      { team_member_id: "tm1", resource_key: "leads", action_key: "create", value: "allowed" },
    ]);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "import_leads",
    });

    expect(result.allowed).toBe(true);
  });

  it("DENIES import_leads when matrix has explicit value=denied (known-denied preserved)", async () => {
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

  it("admin still bypasses the matrix path (allow preserved)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", [
      { id: "tm1", user_id: "u1", organization_id: "org-1", role: "admin", is_active: true },
    ]);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "import_leads",
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("admin");
  });

  it("master still bypasses the matrix path (allow preserved)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("master_users", [{ id: "m1", user_id: "u1", is_active: true }]);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1", action: "import_leads",
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("master_user");
  });

  it("terminal fallback (no mapping at all) denies with a reason", async () => {
    // Force an action that has no mapping in any of the cascade tables by
    // bypassing the typed signature. This exercises the terminal fallthrough.
    const { sb, mockTable } = createMockSupabase();
    asMember(mockTable);
    const result = await canUserPerformAction({
      supabase: sb, userId: "u1", organizationId: "org-1",
      action: "some_unknown_action" as never,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason!.length).toBeGreaterThan(0);
  });
});
