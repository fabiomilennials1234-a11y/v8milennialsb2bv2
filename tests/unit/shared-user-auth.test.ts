import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv } from "../../tests/helpers/deno-mock";

// Mock logger
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn().mockResolvedValue(undefined),
}));

// ─── Configurable createClient mock ───────────────────────────────────────
// Tests mutate `mockState` to shape auth + table responses per scenario.

const mockState = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  return {
    // auth.getUser → { user, error }
    user: null as { id: string } | null,
    authError: null as unknown,
    // tables keyed by name → rows; queries with eq() filter client-side
    tables: {} as Record<string, Row[]>,
    reset() {
      this.user = null;
      this.authError = null;
      this.tables = {};
    },
  };
});

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => {
  function buildClient() {
    function makeChain(tableName: string) {
      const filters: Array<{ field: string; value: unknown }> = [];
      const chain: Record<string, any> = {};
      ["select", "order", "limit", "is", "not", "neq"].forEach((m) => {
        chain[m] = () => chain;
      });
      chain.eq = (field: string, value: unknown) => {
        filters.push({ field, value });
        return chain;
      };
      const resolve = () => {
        const rows = mockState.tables[tableName] || [];
        const filtered = rows.filter((r) =>
          filters.every((f) => r[f.field] === f.value),
        );
        return { data: filtered[0] || null, error: null };
      };
      chain.single = () => Promise.resolve(resolve());
      chain.maybeSingle = () => Promise.resolve(resolve());
      chain.then = (onFulfilled: any) => {
        const rows = mockState.tables[tableName] || [];
        const filtered = rows.filter((r) =>
          filters.every((f) => r[f.field] === f.value),
        );
        return Promise.resolve({ data: filtered, error: null }).then(onFulfilled);
      };
      return chain;
    }
    return {
      from: (table: string) => makeChain(table),
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: mockState.user },
            error: mockState.authError,
          }),
      },
    };
  }
  return { createClient: () => buildClient() };
});

setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
setDenoEnv("SUPABASE_ANON_KEY", "test-anon-key");
setDenoEnv("INTERNAL_API_KEY", "internal-secret");

import {
  AuthError,
  authErrorResponse,
  requireAuth,
  requireAdmin,
  resolvePermission,
  type AuthContext,
} from "../../supabase/functions/_shared/user-auth";

beforeEach(() => {
  mockState.reset();
});

// ─── AuthError + authErrorResponse ────────────────────────────────────────

describe("AuthError", () => {
  it("creates error with default status 401", () => {
    const err = new AuthError("Unauthorized");
    expect(err.message).toBe("Unauthorized");
    expect(err.status).toBe(401);
    expect(err.name).toBe("AuthError");
  });

  it("creates error with custom status", () => {
    const err = new AuthError("Forbidden", 403);
    expect(err.status).toBe(403);
  });

  it("is instance of Error", () => {
    expect(new AuthError("x")).toBeInstanceOf(Error);
  });
});

describe("authErrorResponse", () => {
  it("returns 401 response for unauthorized", async () => {
    const err = new AuthError("Not logged in", 401);
    const response = authErrorResponse(err, { "Access-Control-Allow-Origin": "*" });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Unauthorized");
    expect(body.message).toBe("Not logged in");
  });

  it("returns 403 response for forbidden", async () => {
    const err = new AuthError("No access", 403);
    const response = authErrorResponse(err, {});
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
  });

  it("propagates CORS + content-type headers", async () => {
    const err = new AuthError("Test", 401);
    const response = authErrorResponse(err, {
      "Access-Control-Allow-Origin": "https://torquecrm.com.br",
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://torquecrm.com.br",
    );
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });
});

// ─── extractToken paths (via requireAuth rejections) ──────────────────────

describe("requireAuth — token extraction", () => {
  it("throws when no token found in request", async () => {
    const req = new Request("https://test.com/api", { method: "POST" });
    await expect(requireAuth(req)).rejects.toThrow(/Token/);
  });

  it("reads token from Authorization Bearer header", async () => {
    mockState.authError = { message: "Invalid token" };
    const req = new Request("https://test.com/api", {
      headers: { Authorization: "Bearer abc" },
    });
    await expect(requireAuth(req)).rejects.toThrow(/JWT/);
  });

  it("reads token from X-User-JWT header", async () => {
    mockState.authError = { message: "Invalid token" };
    const req = new Request("https://test.com/api", {
      headers: { "X-User-JWT": "jwt-token" },
    });
    await expect(requireAuth(req)).rejects.toThrow(/JWT/);
  });

  it("reads token from body user_jwt", async () => {
    mockState.authError = { message: "Invalid" };
    const req = new Request("https://test.com/api", { method: "POST" });
    await expect(
      requireAuth(req, { body: { user_jwt: "body-token" } }),
    ).rejects.toThrow(/JWT/);
  });

  it("empty body token falls through to other sources", async () => {
    const req = new Request("https://test.com/api", { method: "POST" });
    // empty string user_jwt should return null, then headers checked, still no token
    await expect(
      requireAuth(req, { body: { user_jwt: "   " } }),
    ).rejects.toThrow(/Token/);
  });
});

// ─── requireAuth happy paths ──────────────────────────────────────────────

describe("requireAuth — happy paths", () => {
  it("authenticates member with team_member in org", async () => {
    mockState.user = { id: "u1" };
    mockState.tables.team_members = [
      {
        id: "tm1",
        user_id: "u1",
        organization_id: "org-1",
        role: "membro",
        is_active: true,
        job_title: "SDR",
        metric_type: "meetings",
      },
    ];
    const req = new Request("https://test.com/api", {
      headers: { Authorization: "Bearer valid" },
    });
    const ctx = await requireAuth(req, { organizationId: "org-1" });
    expect(ctx.userId).toBe("u1");
    expect(ctx.teamMemberId).toBe("tm1");
    expect(ctx.role).toBe("membro");
    expect(ctx.isAdmin).toBe(false);
    expect(ctx.isMaster).toBe(false);
    expect(ctx.jobTitle).toBe("SDR");
    expect(ctx.metricType).toBe("meetings");
  });

  it("flags admin correctly", async () => {
    mockState.user = { id: "u2" };
    mockState.tables.team_members = [
      {
        id: "tm2",
        user_id: "u2",
        organization_id: "org-1",
        role: "admin",
        is_active: true,
        job_title: null,
        metric_type: null,
      },
    ];
    const req = new Request("https://x", { headers: { Authorization: "Bearer v" } });
    const ctx = await requireAuth(req, { organizationId: "org-1" });
    expect(ctx.isAdmin).toBe(true);
    expect(ctx.role).toBe("admin");
    expect(ctx.jobTitle).toBe(""); // null fallback
    expect(ctx.metricType).toBe("meetings"); // default
  });

  it("master user with no team_member still authenticates", async () => {
    mockState.user = { id: "u-master" };
    mockState.tables.master_users = [
      { id: "m1", user_id: "u-master", is_active: true },
    ];
    const req = new Request("https://x", { headers: { Authorization: "Bearer v" } });
    const ctx = await requireAuth(req, { organizationId: "org-1" });
    expect(ctx.isMaster).toBe(true);
    expect(ctx.isAdmin).toBe(true);
    expect(ctx.teamMemberId).toBe("");
    expect(ctx.organizationId).toBe("org-1");
    expect(ctx.role).toBe("admin");
  });

  it("member without team_member in org → 403", async () => {
    mockState.user = { id: "u3" };
    const req = new Request("https://x", { headers: { Authorization: "Bearer v" } });
    await expect(
      requireAuth(req, { organizationId: "org-1" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("falls back to first active team_member when no org passed", async () => {
    mockState.user = { id: "u4" };
    mockState.tables.team_members = [
      {
        id: "tm4",
        user_id: "u4",
        organization_id: "org-fallback",
        role: "membro",
        is_active: true,
        job_title: "Closer",
        metric_type: "sales",
      },
    ];
    const req = new Request("https://x", { headers: { Authorization: "Bearer v" } });
    const ctx = await requireAuth(req);
    expect(ctx.organizationId).toBe("org-fallback");
    expect(ctx.metricType).toBe("sales");
  });

  it("picks organization_id from body when options.organizationId missing", async () => {
    mockState.user = { id: "u5" };
    mockState.tables.team_members = [
      {
        id: "tm5",
        user_id: "u5",
        organization_id: "org-body",
        role: "admin",
        is_active: true,
        job_title: null,
        metric_type: null,
      },
    ];
    const req = new Request("https://x", { headers: { Authorization: "Bearer v" } });
    const ctx = await requireAuth(req, { body: { organization_id: "org-body" } });
    expect(ctx.organizationId).toBe("org-body");
  });
});

// ─── requireOrganization (modo estrito multi-tenant) ──────────────────────

describe("requireAuth — requireOrganization", () => {
  it("throws 400 when requireOrganization=true and no orgId provided (non-master)", async () => {
    mockState.user = { id: "u-multi" };
    // user tem team_member em DUAS orgs — fallback iria pegar a errada
    mockState.tables.team_members = [
      { id: "tm-A", user_id: "u-multi", organization_id: "org-A", role: "admin", is_active: true, job_title: null, metric_type: null },
      { id: "tm-B", user_id: "u-multi", organization_id: "org-B", role: "membro", is_active: true, job_title: null, metric_type: null },
    ];
    const req = new Request("https://x", { headers: { Authorization: "Bearer v" } });
    await expect(
      requireAuth(req, { requireOrganization: true }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("resolves against the exact org when organization_id is in body (multi-org user)", async () => {
    mockState.user = { id: "u-multi" };
    mockState.tables.team_members = [
      { id: "tm-A", user_id: "u-multi", organization_id: "org-A", role: "admin", is_active: true, job_title: null, metric_type: null },
      { id: "tm-B", user_id: "u-multi", organization_id: "org-B", role: "membro", is_active: true, job_title: null, metric_type: null },
    ];
    const req = new Request("https://x", { headers: { Authorization: "Bearer v" } });
    const ctx = await requireAuth(req, {
      body: { organization_id: "org-B" },
      requireOrganization: true,
    });
    expect(ctx.organizationId).toBe("org-B");
    expect(ctx.teamMemberId).toBe("tm-B");
    expect(ctx.role).toBe("membro");
    expect(ctx.isAdmin).toBe(false);
  });

  it("master user bypasses requireOrganization (master is global)", async () => {
    mockState.user = { id: "u-master" };
    mockState.tables.master_users = [{ id: "m1", user_id: "u-master", is_active: true }];
    const req = new Request("https://x", { headers: { Authorization: "Bearer v" } });
    const ctx = await requireAuth(req, { requireOrganization: true });
    expect(ctx.isMaster).toBe(true);
    expect(ctx.isAdmin).toBe(true);
  });

  it("rejects when body.organization_id is an org the user does not belong to", async () => {
    mockState.user = { id: "u1" };
    mockState.tables.team_members = [
      { id: "tm1", user_id: "u1", organization_id: "org-mine", role: "admin", is_active: true, job_title: null, metric_type: null },
    ];
    const req = new Request("https://x", { headers: { Authorization: "Bearer v" } });
    await expect(
      requireAuth(req, { body: { organization_id: "org-other" }, requireOrganization: true }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

// ─── Internal API key path ────────────────────────────────────────────────

describe("requireAuth — internal API key", () => {
  it("returns internal context when key matches", async () => {
    const req = new Request("https://x", {
      headers: { "X-Internal-Api-Key": "internal-secret" },
    });
    const ctx = await requireAuth(req, {
      allowInternalKey: true,
      body: { organization_id: "org-internal" },
    });
    expect(ctx.userId).toBe("internal");
    expect(ctx.isAdmin).toBe(true);
    expect(ctx.organizationId).toBe("org-internal");
  });

  it("rejects when internal key missing organization_id", async () => {
    const req = new Request("https://x", {
      headers: { "X-Internal-Api-Key": "internal-secret" },
    });
    await expect(
      requireAuth(req, { allowInternalKey: true }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("ignores internal key when allowInternalKey is false", async () => {
    const req = new Request("https://x", {
      headers: { "X-Internal-Api-Key": "internal-secret" },
    });
    // falls through to JWT extraction → no token
    await expect(requireAuth(req)).rejects.toThrow(/Token/);
  });

  it("rejects wrong internal key", async () => {
    const req = new Request("https://x", {
      headers: { "X-Internal-Api-Key": "wrong" },
    });
    await expect(
      requireAuth(req, { allowInternalKey: true }),
    ).rejects.toThrow(/Token/);
  });
});

// ─── requireAdmin ─────────────────────────────────────────────────────────

describe("requireAdmin", () => {
  it("returns ctx when user is admin", async () => {
    mockState.user = { id: "u1" };
    mockState.tables.team_members = [
      {
        id: "tm1",
        user_id: "u1",
        organization_id: "org-1",
        role: "admin",
        is_active: true,
        job_title: null,
        metric_type: null,
      },
    ];
    const req = new Request("https://x", { headers: { Authorization: "Bearer v" } });
    const ctx = await requireAdmin(req, { organizationId: "org-1" });
    expect(ctx.isAdmin).toBe(true);
  });

  it("throws 403 when user is not admin", async () => {
    mockState.user = { id: "u1" };
    mockState.tables.team_members = [
      {
        id: "tm1",
        user_id: "u1",
        organization_id: "org-1",
        role: "membro",
        is_active: true,
        job_title: null,
        metric_type: null,
      },
    ];
    const req = new Request("https://x", { headers: { Authorization: "Bearer v" } });
    await expect(
      requireAdmin(req, { organizationId: "org-1" }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

// ─── resolvePermission cascade ────────────────────────────────────────────

describe("resolvePermission", () => {
  it("returns true for master user", async () => {
    mockState.tables.master_users = [
      { id: "m1", user_id: "u-master", is_active: true },
    ];
    expect(await resolvePermission("u-master", "org-1", "can_delete_leads")).toBe(
      true,
    );
  });

  it("returns false when user has no team_member in org", async () => {
    expect(await resolvePermission("u-nobody", "org-1", "can_delete_leads")).toBe(
      false,
    );
  });

  it("returns true for admin", async () => {
    mockState.tables.team_members = [
      { id: "tm1", user_id: "u1", organization_id: "org-1", role: "admin", is_active: true },
    ];
    expect(await resolvePermission("u1", "org-1", "can_delete_leads")).toBe(true);
  });

  it("individual override enabled=true wins", async () => {
    mockState.tables.team_members = [
      { id: "tm1", user_id: "u1", organization_id: "org-1", role: "membro", is_active: true },
    ];
    mockState.tables.team_member_org_permissions = [
      { team_member_id: "tm1", permission_key: "can_delete_leads", enabled: true },
    ];
    expect(await resolvePermission("u1", "org-1", "can_delete_leads")).toBe(true);
  });

  it("individual override enabled=false wins over role", async () => {
    mockState.tables.team_members = [
      { id: "tm1", user_id: "u1", organization_id: "org-1", role: "membro", is_active: true },
    ];
    mockState.tables.team_member_org_permissions = [
      { team_member_id: "tm1", permission_key: "can_delete_leads", enabled: false },
    ];
    mockState.tables.organization_role_permissions = [
      {
        organization_id: "org-1",
        role: "membro",
        permission_key: "can_delete_leads",
        enabled: true,
      },
    ];
    expect(await resolvePermission("u1", "org-1", "can_delete_leads")).toBe(false);
  });

  it("falls back to role permission when no individual override", async () => {
    mockState.tables.team_members = [
      { id: "tm1", user_id: "u1", organization_id: "org-1", role: "membro", is_active: true },
    ];
    mockState.tables.organization_role_permissions = [
      {
        organization_id: "org-1",
        role: "membro",
        permission_key: "can_delete_leads",
        enabled: true,
      },
    ];
    expect(await resolvePermission("u1", "org-1", "can_delete_leads")).toBe(true);
  });

  it("returns false when neither override nor role permission found", async () => {
    mockState.tables.team_members = [
      { id: "tm1", user_id: "u1", organization_id: "org-1", role: "membro", is_active: true },
    ];
    expect(await resolvePermission("u1", "org-1", "can_delete_leads")).toBe(false);
  });
});

// ─── Type exports ─────────────────────────────────────────────────────────

describe("Type exports", () => {
  it("AuthContext shape", () => {
    const ctx: AuthContext = {
      userId: "u1",
      teamMemberId: "tm1",
      organizationId: "org-1",
      role: "admin",
      isMaster: false,
      isAdmin: true,
      jobTitle: "SDR",
      metricType: "meetings",
    };
    expect(ctx.userId).toBe("u1");
    expect(ctx.isAdmin).toBe(true);
  });
});
