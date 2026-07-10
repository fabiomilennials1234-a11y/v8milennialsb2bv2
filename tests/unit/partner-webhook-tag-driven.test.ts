/**
 * Unit test for partner-webhook tag-driven routing.
 *
 * When the caller (e.g. DNA/Zuvic) sends platform-managed `sys:` tags, the lead's
 * funnel position is decided by native tag→stage workflows. partner-webhook must
 * NOT forward the caller's pipe/stage in that case (Zuvic routes checkout.success →
 * confirmacao/ganho, which would drop a paid subscriber into the meeting funnel).
 * Without a sys: tag (e.g. plain lead.created), pipe/stage is forwarded as before.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const capture = vi.hoisted(() => ({
  handler: null as null | ((req: Request) => Promise<Response>),
  forwarded: null as any,
}));

// partner-webhook calls Deno.serve(...) at module load — provide it before import.
vi.hoisted(() => {
  const g = globalThis as any;
  if (typeof g.Deno === "undefined") {
    const env: Record<string, string> = {};
    g.Deno = {
      env: {
        get: (k: string) => env[k],
        set: (k: string, v: string) => { env[k] = v; },
        delete: (k: string) => { delete env[k]; },
        toObject: () => ({ ...env }),
      },
    };
  }
  g.Deno.serve = (_h: any) => {};
});

vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_name: string, h: any) => {
    capture.handler = h;
    return h;
  },
}));

vi.mock("../../supabase/functions/_shared/cors.ts", () => ({
  getCorsHeaders: () => ({}),
}));

vi.mock("../../supabase/functions/_shared/security-headers.ts", () => ({
  withSecurityHeaders: (h: Record<string, string>) => h,
}));

vi.mock("../../supabase/functions/_shared/auth.ts", () => ({
  validateApiKey: vi.fn(async () => ({
    valid: true,
    organizationId: "org-1",
    keyId: "key-1",
    scopes: ["lead:write"],
    rateLimitPerMinute: 60,
  })),
  checkRateLimit: () => ({ allowed: true, resetIn: 60_000 }),
  getClientIdentifier: () => "1.2.3.4",
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => ({
    from: () => ({ insert: () => Promise.resolve({}) }),
  }),
}));

import "../../supabase/functions/partner-webhook/index";

function invoke(body: unknown) {
  const h = capture.handler;
  if (!h) throw new Error("handler not captured");
  return h(
    new Request("https://x/partner-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "k" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  const env = (globalThis as any).Deno.env;
  env.set("SUPABASE_URL", "https://test.supabase.co");
  env.set("SUPABASE_SERVICE_ROLE_KEY", "svc");
  env.set("WEBHOOK_API_KEY", "wh");
  capture.forwarded = null;
  globalThis.fetch = vi.fn(async (_url: any, opts: any) => {
    capture.forwarded = JSON.parse(opts.body);
    return new Response(JSON.stringify({ lead_id: "lead-1" }), { status: 200 });
  }) as any;
});

describe("partner-webhook — tag-driven routing", () => {
  it("drops caller pipe/stage when a sys: tag is present", async () => {
    const res = await invoke({
      name: "João Cliente",
      email: "c@x.com",
      phone: "5511988887777",
      pipe: "confirmacao",
      stage: "ganho",
      tags: ["sys:assinante"],
    });
    expect(res.status).toBe(200);
    expect(capture.forwarded).toBeTruthy();
    expect(capture.forwarded.tags).toEqual(["sys:assinante"]);
    // Tag-driven: caller's confirmacao/ganho must NOT be forwarded.
    expect(capture.forwarded.place_in_pipe).toBeUndefined();
  });

  it("forwards pipe/stage when no sys: tag (plain lead)", async () => {
    const res = await invoke({
      name: "Lead WEB",
      phone: "5511988887777",
      pipe: "whatsapp",
      stage: "novo",
      tags: ["WEB-INSTAGRAM"],
    });
    expect(res.status).toBe(200);
    expect(capture.forwarded.place_in_pipe).toEqual({ pipe: "whatsapp", stage: "novo" });
  });

  it("forwards pipe/stage when no tags at all", async () => {
    const res = await invoke({
      name: "Lead",
      phone: "5511988887777",
      pipe: "whatsapp",
      stage: "novo_lead",
    });
    expect(res.status).toBe(200);
    expect(capture.forwarded.place_in_pipe).toEqual({ pipe: "whatsapp", stage: "novo_lead" });
  });
});
