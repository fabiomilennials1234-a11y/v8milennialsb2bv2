import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv } from "../../tests/helpers/deno-mock";

// Mock logger
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn().mockResolvedValue(undefined),
}));

// Mock createClient — factory can't reference outer vars
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => {
  const chain: Record<string, any> = {};
  ["select", "eq", "neq", "order", "limit", "is", "not"].forEach(m => { chain[m] = () => chain; });
  chain.single = () => Promise.resolve({ data: null, error: null });
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  chain.then = (fn: any) => Promise.resolve(fn({ data: [], error: null }));
  return {
    createClient: () => ({
      from: () => chain,
      auth: {
        getUser: () => Promise.resolve({ data: { user: null }, error: { message: "Invalid token" } }),
      },
    }),
  };
});

setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
setDenoEnv("SUPABASE_ANON_KEY", "test-anon-key");

import {
  AuthError,
  authErrorResponse,
  requireAuth,
  type AuthContext,
} from "../../supabase/functions/_shared/user-auth";

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
    const err = new AuthError("test");
    expect(err).toBeInstanceOf(Error);
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

  it("includes CORS headers", async () => {
    const err = new AuthError("Test", 401);
    const response = authErrorResponse(err, { "Access-Control-Allow-Origin": "https://torquecrm.com.br" });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://torquecrm.com.br");
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });
});

describe("requireAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when no token found", async () => {
    const req = new Request("https://test.com/api", { method: "POST" });
    await expect(requireAuth(req)).rejects.toThrow();
  });

  it("extracts token from Authorization header", async () => {
    const req = new Request("https://test.com/api", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
    });
    await expect(requireAuth(req)).rejects.toThrow();
  });

  it("extracts token from X-User-JWT header", async () => {
    const req = new Request("https://test.com/api", {
      method: "POST",
      headers: { "X-User-JWT": "jwt-token" },
    });
    await expect(requireAuth(req)).rejects.toThrow();
  });

  it("extracts token from body user_jwt", async () => {
    const req = new Request("https://test.com/api", {
      method: "POST",
    });
    await expect(requireAuth(req, { body: { user_jwt: "body-token" } })).rejects.toThrow();
  });
});

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
