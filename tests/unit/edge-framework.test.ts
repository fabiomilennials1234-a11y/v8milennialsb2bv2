/**
 * createEdgeFunction — unified handler framework (#166)
 *
 * Tests: CORS, OPTIONS 204, auth dispatch, error wrapping, method restriction,
 * Supabase client injection, error-boundary wrapping.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubGlobal("Deno", {
  env: {
    get: (k: string) => {
      const m: Record<string, string> = {
        SUPABASE_URL: "https://local.test",
        SUPABASE_SERVICE_ROLE_KEY: "svc-role",
        SUPABASE_ANON_KEY: "anon-key",
        CRON_SECRET: "my-cron-secret",
        ALLOWED_ORIGINS: "https://torquecrm.com.br",
      };
      return m[k] ?? undefined;
    },
    toObject: () => ({}),
  },
  serve: vi.fn(),
});

vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_n: string, fn: unknown) => fn,
  logError: vi.fn(async () => {}),
  logEvent: vi.fn(async () => {}),
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: vi.fn(() => ({ from: vi.fn(), rpc: vi.fn() })),
}));

import { createEdgeFunction } from "../../supabase/functions/_shared/edge-framework.ts";

function makeRequest(method: string, body?: object, headers?: Record<string, string>): Request {
  return new Request("https://local.test/fn", {
    method,
    headers: {
      "Content-Type": "application/json",
      origin: "https://torquecrm.com.br",
      ...headers,
    },
    ...(body && method !== "GET" ? { body: JSON.stringify(body) } : {}),
  });
}

describe("createEdgeFunction", () => {
  describe("OPTIONS preflight", () => {
    it("returns 204 with CORS headers on OPTIONS", async () => {
      const handler = createEdgeFunction({
        name: "test-fn",
        handler: async () => ({ data: "ok" }),
      });

      const res = await handler(makeRequest("OPTIONS"));

      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });
  });

  describe("CORS on all responses", () => {
    it("includes CORS + security headers on success response", async () => {
      const handler = createEdgeFunction({
        name: "test-fn",
        handler: async () => ({ data: "ok" }),
      });

      const res = await handler(makeRequest("POST", { test: true }));

      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    });

    it("includes CORS headers on error responses", async () => {
      const handler = createEdgeFunction({
        name: "test-fn",
        handler: async () => { throw new Error("boom"); },
      });

      const res = await handler(makeRequest("POST"));

      expect(res.status).toBe(500);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
    });
  });

  describe("method restriction", () => {
    it("returns 405 when method not allowed", async () => {
      const handler = createEdgeFunction({
        name: "test-fn",
        methods: ["POST"],
        handler: async () => ({ data: "ok" }),
      });

      const res = await handler(makeRequest("GET"));

      expect(res.status).toBe(405);
      const body = await res.json();
      expect(body.error).toContain("Method not allowed");
    });

    it("allows request when method matches", async () => {
      const handler = createEdgeFunction({
        name: "test-fn",
        methods: ["POST"],
        handler: async () => ({ data: "ok" }),
      });

      const res = await handler(makeRequest("POST", { test: true }));
      expect(res.status).toBe(200);
    });
  });

  describe("auth: cron-secret", () => {
    it("rejects request without cron secret", async () => {
      const handler = createEdgeFunction({
        name: "test-fn",
        auth: "cron-secret",
        handler: async () => ({ data: "ok" }),
      });

      const res = await handler(makeRequest("POST", { test: true }));

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("Unauthorized");
    });

    it("accepts request with valid cron secret", async () => {
      const handler = createEdgeFunction({
        name: "test-fn",
        auth: "cron-secret",
        handler: async () => ({ data: "ok" }),
      });

      const res = await handler(makeRequest("POST", { test: true }, { "x-cron-secret": "my-cron-secret" }));
      expect(res.status).toBe(200);
    });
  });

  describe("auth: none", () => {
    it("allows request without any auth", async () => {
      const handler = createEdgeFunction({
        name: "test-fn",
        auth: "none",
        handler: async () => ({ data: "ok" }),
      });

      const res = await handler(makeRequest("POST", { test: true }));
      expect(res.status).toBe(200);
    });
  });

  describe("context injection", () => {
    it("injects supabase client into handler context", async () => {
      let receivedCtx: any = null;
      const handler = createEdgeFunction({
        name: "test-fn",
        handler: async (ctx) => {
          receivedCtx = ctx;
          return { data: "ok" };
        },
      });

      await handler(makeRequest("POST", { hello: "world" }));

      expect(receivedCtx).not.toBeNull();
      expect(receivedCtx.supabase).toBeDefined();
      expect(receivedCtx.body).toEqual({ hello: "world" });
      expect(receivedCtx.req).toBeDefined();
    });
  });

  describe("JSON body parsing", () => {
    it("parses JSON body for POST requests", async () => {
      let receivedBody: any = null;
      const handler = createEdgeFunction({
        name: "test-fn",
        handler: async (ctx) => {
          receivedBody = ctx.body;
          return { received: true };
        },
      });

      await handler(makeRequest("POST", { key: "value" }));
      expect(receivedBody).toEqual({ key: "value" });
    });

    it("returns 400 on malformed JSON", async () => {
      const handler = createEdgeFunction({
        name: "test-fn",
        methods: ["POST"],
        handler: async () => ({ data: "ok" }),
      });

      const req = new Request("https://local.test/fn", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "https://torquecrm.com.br" },
        body: "not json {{{",
      });

      const res = await handler(req);
      expect(res.status).toBe(400);
    });
  });

  describe("error handling", () => {
    it("catches handler errors and returns 500 with CORS", async () => {
      const handler = createEdgeFunction({
        name: "test-fn",
        handler: async () => { throw new Error("Internal failure"); },
      });

      const res = await handler(makeRequest("POST"));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("Internal failure");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
    });
  });

  describe("response serialization", () => {
    it("serializes handler return value as JSON", async () => {
      const handler = createEdgeFunction({
        name: "test-fn",
        handler: async () => ({ users: [1, 2, 3], total: 3 }),
      });

      const res = await handler(makeRequest("POST"));
      const body = await res.json();

      expect(body.users).toEqual([1, 2, 3]);
      expect(body.total).toBe(3);
    });

    it("passes through Response objects from handler", async () => {
      const handler = createEdgeFunction({
        name: "test-fn",
        handler: async () => new Response("raw", { status: 201 }),
      });

      const res = await handler(makeRequest("POST"));
      expect(res.status).toBe(201);
    });
  });
});
