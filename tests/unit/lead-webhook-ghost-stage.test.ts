/**
 * Unit test for the ghost-stage guard in lead-webhook place_in_pipe resolution.
 *
 * Regression: DNA de Almas 2026-06 — Zuvic sent place_in_pipe={whatsapp, "novo"}
 * but the org had deactivated the "novo" stage (uses "novo_lead" as first active).
 * The inline resolver wrote the literal "novo" → leads landed in an inactive stage
 * → invisible in the Kanban. Fix: on no active-stage match, fall back to
 * resolveActiveStageKey() (first active stage) instead of the literal.
 *
 * Here pipeline-adapter is mocked to (a) make the inline match miss and (b) capture
 * the stage_key actually written, asserting it was remapped to the active stage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

const capture = vi.hoisted(() => ({
  handler: null as null | ((req: Request) => Promise<Response>),
}));

vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({
  serve: (h: any) => {
    capture.handler = h;
  },
}));

vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_name: string, handler: any) => handler,
}));

const state = vi.hoisted(() => ({
  mock: null as null | ReturnType<typeof createMockSupabase>,
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => {
    if (!state.mock) throw new Error("test did not configure supabase mock");
    const inner = state.mock.sb;
    return {
      ...inner,
      rpc: () => Promise.resolve({ data: null, error: null }),
    };
  },
}));

// ─── Mock pipeline-adapter: capture the written stage + control the resolver ──
const mockUpsertPipeEntry = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetPipeEntry = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockUpdatePipeEntryById = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockResolveActiveStageKey = vi.hoisted(() => vi.fn());

vi.mock("../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  upsertPipeEntry: mockUpsertPipeEntry,
  getPipeEntry: mockGetPipeEntry,
  updatePipeEntryById: mockUpdatePipeEntryById,
  resolveActiveStageKey: mockResolveActiveStageKey,
}));

const mockGetOrCreateLead = vi.hoisted(() => vi.fn());
vi.mock("../../supabase/functions/_shared/lead-service.ts", () => ({
  getOrCreateLead: mockGetOrCreateLead,
}));

vi.mock("../../supabase/functions/_shared/webhook-utils.ts", () => ({
  enqueueWebhookDeliveries: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../supabase/functions/_shared/campaign-distribution.ts", () => ({
  getCampaignLeadAssignment: vi.fn().mockResolvedValue(null),
  getCampaignCloserAssignment: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../supabase/functions/_shared/auth.ts", () => ({
  timingSafeCompare: (a: string, b: string) => a === b,
  checkRateLimit: () => ({ allowed: true, remaining: 59, resetIn: 60000 }),
  checkRateLimitPersistent: vi.fn(async () => ({ allowed: true, remaining: 59, resetAt: "" })),
  getClientIdentifier: () => "127.0.0.1",
  rateLimitedResponse: (_resetIn: number, corsHeaders: Record<string, string>) =>
    new Response(JSON.stringify({ error: "Too Many Requests" }), { status: 429, headers: corsHeaders }),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

import "../../supabase/functions/lead-webhook/index";

function invoke(body: unknown) {
  const h = capture.handler;
  if (!h) throw new Error("handler not captured");
  return h(
    new Request("https://x/lead-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-key": "secret" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  clearDenoEnv();
  setDenoEnv("WEBHOOK_API_KEY", "secret");
  setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
  setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "svc-key");
  vi.clearAllMocks();
  mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));
  mockGetPipeEntry.mockResolvedValue(null);
  mockUpsertPipeEntry.mockResolvedValue(undefined);

  const { sb, mockTable } = createMockSupabase();
  mockTable("organizations", [{ id: "org-1" }]);
  mockTable("leads", []);
  mockTable("pipe_whatsapp", []);
  // Active stages do NOT include "novo" — first active is "novo_lead".
  mockTable("pipeline_stages", [
    { organization_id: "org-1", pipeline_type: "whatsapp", stage_key: "novo_lead", name: "🆕 Novo Lead", is_active: true, position: 0 },
    { organization_id: "org-1", pipeline_type: "whatsapp", stage_key: "pago", name: "✅ Pago", is_active: true, position: 3 },
  ]);
  mockTable("tags", []);
  mockTable("lead_tags", []);
  state.mock = { sb, mockTable } as any;

  mockGetOrCreateLead.mockResolvedValue({
    lead: { id: "lead-1", name: "X", phone: "11999", email: "e@x", organization_id: "org-1" },
    created: true,
    source: "created",
  });
});

describe("lead-webhook — ghost-stage guard (place_in_pipe)", () => {
  it("remaps an inactive requested stage to the first active stage", async () => {
    mockResolveActiveStageKey.mockResolvedValue("novo_lead");

    const res = await invoke({
      source: "dna_api_lead",
      update_existing_if_match: true,
      fields: { phone: "11999", email: "e@x" },
      place_in_pipe: { pipe: "whatsapp", stage: "novo" }, // "novo" is inactive
    });

    expect(res.status).toBe(200);
    // Guard consulted with the requested (inactive) stage.
    expect(mockResolveActiveStageKey).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      "whatsapp",
      "novo",
    );
    // Entry written at the remapped active stage, NOT the literal "novo".
    expect(mockUpsertPipeEntry).toHaveBeenCalledTimes(1);
    expect(mockUpsertPipeEntry.mock.calls[0][1]).toMatchObject({ stageKey: "novo_lead" });
  });

  it("keeps a valid active stage as-is (no remap)", async () => {
    const res = await invoke({
      source: "dna_api_lead",
      update_existing_if_match: true,
      fields: { phone: "11999", email: "e@x" },
      place_in_pipe: { pipe: "whatsapp", stage: "pago" }, // active → inline match
    });

    expect(res.status).toBe(200);
    // Inline match succeeds → guard fallback never invoked.
    expect(mockResolveActiveStageKey).not.toHaveBeenCalled();
    expect(mockUpsertPipeEntry.mock.calls[0][1]).toMatchObject({ stageKey: "pago" });
  });
});
