/**
 * Regression: lead-webhook must DISCARD Meta Lead Ads "Testing Tool" dummy
 * leads instead of persisting them.
 *
 * Meta's testing tool posts leads with email=test@meta.com and field values
 * "<test lead: dummy data for {campo}>". They are not real leads — they only
 * validate the webhook. The old code detected them solely to skip dedup, but
 * STILL inserted them, so junk accumulated across orgs (28 polluted; HGE's
 * "leads fantasmas" stuck in a deactivated stage). The fix: detect dummy ->
 * ack 200 WITHOUT creating any lead. Meta only needs a 200.
 *
 * Mocks let the handler run end-to-end; we assert the dummy path returns the
 * ack shape and persists nothing (no getOrCreateLead, no leads insert), while a
 * real lead still flows to creation.
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

vi.mock("../../supabase/functions/_shared/sentry.ts", () => ({
  withSentry: (_name: string, handler: any) => handler,
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

const mockUpsertPipeEntry = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetPipeEntry = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockUpdatePipeEntryById = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockResolveActiveStageKey = vi.hoisted(() => vi.fn().mockResolvedValue("novo_lead"));

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

  const { sb, mockTable, getInserted } = createMockSupabase();
  mockTable("organizations", [{ id: "org-1" }]);
  mockTable("leads", []);
  mockTable("pipeline_stages", [
  ]);
  mockTable("tags", []);
  mockTable("lead_tags", []);
  state.mock = { sb, mockTable, getInserted } as any;

  mockGetOrCreateLead.mockResolvedValue({
    lead: { id: "lead-1", name: "Real Person", phone: "11999", email: "real@x.com", organization_id: "org-1" },
    created: true,
    source: "created",
  });
});

const getInserted = () => (state.mock as any).getInserted("leads") as unknown[];

describe("lead-webhook — Meta dummy test-lead discard", () => {
  it("discards a dummy detected by email=test@meta.com (ack 200, no lead persisted)", async () => {
    const res = await invoke({
      source: "meta_ads",
      update_existing_if_match: true, // would normally dedup+persist
      fields: { name: "<test lead: dummy data for nome_completo>", phone: "11999", email: "test@meta.com" },
      place_in_pipe: { pipe: "whatsapp", stage: "novo" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dummy_test_lead).toBe(true);
    expect(body.lead_id).toBeUndefined();
    // Nothing persisted: neither the dedup service nor a raw insert ran.
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
    expect(getInserted()).toHaveLength(0);
    expect(mockUpsertPipeEntry).not.toHaveBeenCalled();
  });

  it("discards a dummy detected by name only (real-looking email)", async () => {
    const res = await invoke({
      source: "meta_ads",
      fields: { name: "<test lead: dummy data for nome_completo>", phone: "5511988887777", email: "someone@gmail.com" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dummy_test_lead).toBe(true);
    expect(getInserted()).toHaveLength(0);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  it("does NOT short-circuit a real lead (still flows to creation)", async () => {
    const res = await invoke({
      source: "meta_ads",
      update_existing_if_match: true,
      fields: { name: "Maria Souza", phone: "5511955554444", email: "maria@empresa.com" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dummy_test_lead).toBeUndefined();
    expect(body.lead_id).toBe("lead-1");
    expect(mockGetOrCreateLead).toHaveBeenCalledTimes(1);
  });
});
