// @vitest-environment node
/**
 * Unit tests for mass-send-create permission gate (issue #189).
 * TDD: tests written first, then gate added to the edge function.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted — runs BEFORE any import hoisting. Sets up Deno global + captures handler.
const {
  mockAssertPermission,
  mockPermissionDeniedResponse,
  mockGetUser,
  mockFrom,
  mockRpc,
  mockCreateClient,
  getHandler,
} = vi.hoisted(() => {
  const mockAssertPermission = vi.fn();
  const mockPermissionDeniedResponse = vi.fn();
  const mockGetUser = vi.fn();
  const mockFrom = vi.fn();
  const mockRpc = vi.fn();
  const mockCreateClient = vi.fn();
  let _handler: any = null;

  // Full Deno global with env store + serve
  const envStore: Record<string, string> = {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    SUPABASE_ANON_KEY: "anon-key",
    ALLOWED_ORIGINS: "http://localhost:8080",
  };

  (globalThis as any).Deno = {
    env: {
      get: (key: string) => envStore[key] ?? undefined,
      set: (key: string, value: string) => { envStore[key] = value; },
      delete: (key: string) => { delete envStore[key]; },
      toObject: () => ({ ...envStore }),
    },
    resolveDns: async () => [],
    serve: (fn: any) => { _handler = fn; },
  };

  return {
    mockAssertPermission,
    mockPermissionDeniedResponse,
    mockGetUser,
    mockFrom,
    mockRpc,
    mockCreateClient,
    getHandler: () => _handler as (req: Request) => Promise<Response>,
  };
});

vi.mock("../../supabase/functions/_shared/assert-permission.ts", () => ({
  assertPermission: mockAssertPermission,
  permissionDeniedResponse: mockPermissionDeniedResponse,
}));

vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_name: string, handler: Function) => handler,
}));

vi.mock("../../supabase/functions/_shared/cors.ts", () => ({
  getCorsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
}));

vi.mock("../../supabase/functions/_shared/security-headers.ts", () => ({
  withSecurityHeaders: (h: Record<string, string>) => h,
}));

vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../supabase/functions/_shared/dispatch-router.ts", () => ({
  decideDispatchRoute: vi.fn().mockReturnValue({ route: "uazapi_sender", reason: "ok" }),
  runUazapiSenderJob: vi.fn().mockResolvedValue({ sender_job_id: "job-1", uazapi_sender_id: "u-1" }),
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: mockCreateClient,
}));

// Import the edge function (triggers Deno.serve)
import "../../supabase/functions/mass-send-create/index.ts";

// Helpers
function makeRequest(body: object, token = "valid-token") {
  return new Request("http://localhost/mass-send-create", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function setupAuthMocks(role: "admin" | "master" | "member" = "admin") {
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });

  const chainBuilder = () => {
    const chain: any = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.maybeSingle = vi.fn();
    return chain;
  };

  const teamChain = chainBuilder();
  teamChain.maybeSingle.mockResolvedValue({
    data: { organization_id: "org-1", role },
    error: null,
  });

  const instanceChain = chainBuilder();
  instanceChain.maybeSingle.mockResolvedValue({
    data: { id: "inst-1", organization_id: "org-1", provider: "uazapi" },
    error: null,
  });

  mockFrom.mockImplementation((table: string) => {
    if (table === "team_members") return teamChain;
    if (table === "whatsapp_instances") return instanceChain;
    return teamChain;
  });

  mockCreateClient.mockImplementation((_url: string, key: string) => {
    if (key === "anon-key") {
      return { auth: { getUser: mockGetUser } };
    }
    return { from: mockFrom, rpc: mockRpc };
  });

  // Plan gate (org_get_features_and_limits): default = plano com whatsapp_bulk
  mockRpc.mockResolvedValue({
    data: {
      features: { whatsapp_bulk: true },
      limits: { max_users: 5 },
      plan_name: "torque-2.0",
    },
    error: null,
  });
}

const validBody = {
  instance_id: "inst-1",
  recipients: [{ number: "5511999999999", text: "Hello" }],
  template_text: "Hello",
};

describe("mass-send-create permission gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthMocks("admin");
  });

  it("returns 403 when assertPermission returns { allowed: false }", async () => {
    mockAssertPermission.mockResolvedValue({ allowed: false, reason: "feature_disabled" });
    mockPermissionDeniedResponse.mockReturnValue(
      new Response(JSON.stringify({ error: "Permission denied", reason: "feature_disabled" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const res = await getHandler()(makeRequest(validBody));

    expect(res.status).toBe(403);
    expect(mockPermissionDeniedResponse).toHaveBeenCalledWith(
      "feature_disabled",
      expect.any(Object)
    );
  });

  it("proceeds normally when assertPermission returns { allowed: true }", async () => {
    mockAssertPermission.mockResolvedValue({ allowed: true, reason: "admin" });

    const res = await getHandler()(makeRequest(validBody));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sender_job_id).toBe("job-1");
  });

  it("403 response body contains JSON with error and reason", async () => {
    mockAssertPermission.mockResolvedValue({ allowed: false, reason: "role_insufficient" });
    mockPermissionDeniedResponse.mockReturnValue(
      new Response(JSON.stringify({ error: "Permission denied", reason: "role_insufficient" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const res = await getHandler()(makeRequest(validBody));
    const body = await res.json();

    expect(body.error).toBe("Permission denied");
    expect(body.reason).toBe("role_insufficient");
  });

  it("permission check uses action 'mass_send'", async () => {
    mockAssertPermission.mockResolvedValue({ allowed: true, reason: "admin" });

    await getHandler()(makeRequest(validBody));

    expect(mockAssertPermission).toHaveBeenCalledWith(
      expect.anything(), // supabase admin client
      "user-1",         // userId
      "org-1",          // orgId
      "mass_send"       // action
    );
  });

  it("admin user passes permission check (integration-style)", async () => {
    mockAssertPermission.mockResolvedValue({ allowed: true, reason: "admin" });

    const res = await getHandler()(makeRequest(validBody));

    expect(res.status).toBe(200);
    expect(mockAssertPermission).toHaveBeenCalledTimes(1);
  });
});

describe("mass-send-create plan gate (whatsapp_bulk)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthMocks("admin");
    mockAssertPermission.mockResolvedValue({ allowed: true, reason: "admin" });
  });

  it("consulta org_get_features_and_limits com a org do caller", async () => {
    await getHandler()(makeRequest(validBody));

    expect(mockRpc).toHaveBeenCalledWith("org_get_features_and_limits", {
      p_org_id: "org-1",
    });
  });

  it("403 {error, feature, plan} quando plano não tem whatsapp_bulk — sem side-effect", async () => {
    const { runUazapiSenderJob } = await import(
      "../../supabase/functions/_shared/dispatch-router.ts"
    );
    mockRpc.mockResolvedValue({
      data: { features: { whatsapp_bulk: false }, limits: {}, plan_name: "torque-1.0" },
      error: null,
    });

    const res = await getHandler()(makeRequest(validBody));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.feature).toBe("whatsapp_bulk");
    expect(body.plan).toBe("torque-1.0");
    expect(runUazapiSenderJob).not.toHaveBeenCalled();
  });

  it("plan_name=master passa mesmo sem feature no payload", async () => {
    mockRpc.mockResolvedValue({
      data: { features: {}, limits: {}, plan_name: "master" },
      error: null,
    });

    const res = await getHandler()(makeRequest(validBody));
    expect(res.status).toBe(200);
  });

  it("erro na RPC → fail-closed (nenhum job criado)", async () => {
    const { runUazapiSenderJob } = await import(
      "../../supabase/functions/_shared/dispatch-router.ts"
    );
    mockRpc.mockResolvedValue({ data: null, error: { message: "db down" } });

    await expect(getHandler()(makeRequest(validBody))).rejects.toThrow(/plan-gate/);
    expect(runUazapiSenderJob).not.toHaveBeenCalled();
  });

  it("gate roda DEPOIS do permission check (permission denied vence)", async () => {
    mockAssertPermission.mockResolvedValue({ allowed: false, reason: "feature_disabled" });
    mockPermissionDeniedResponse.mockReturnValue(new Response("{}", { status: 403 }));

    await getHandler()(makeRequest(validBody));

    expect(mockRpc).not.toHaveBeenCalled();
  });
});
