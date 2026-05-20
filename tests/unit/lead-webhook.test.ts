/**
 * Unit tests for supabase/functions/lead-webhook/index.ts
 *
 * The edge function registers a handler via `serve(withSentry(...))` at
 * module load. We mock both so the handler is captured and callable in
 * isolation. All external helpers (lead-service, webhook-utils, campaign-
 * distribution, logger) are mocked to avoid network/DB side effects.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

// ─── Capture the handler registered by serve() ────────────────────────────

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

// ─── Configurable supabase client (mutable per test) ──────────────────────

const state = vi.hoisted(() => {
  const createMock = () => {
    // Constructed lazily so each test can swap the mock.
    return null as null | ReturnType<typeof createMockSupabase>;
  };
  return {
    mock: createMock() as ReturnType<typeof createMockSupabase> | null,
    rpcResults: {} as Record<string, unknown>,
  };
});

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => {
    if (!state.mock) throw new Error("test did not configure supabase mock");
    const inner = state.mock.sb;
    // Wrap rpc to route through configured results
    return {
      ...inner,
      rpc: (name: string) => Promise.resolve({
        data: state.rpcResults[name] ?? null,
        error: null,
      }),
    };
  },
}));

// ─── Mock supporting shared modules ───────────────────────────────────────

const mockGetOrCreateLead = vi.hoisted(() => vi.fn());
vi.mock("../../supabase/functions/_shared/lead-service.ts", () => ({
  getOrCreateLead: mockGetOrCreateLead,
}));

vi.mock("../../supabase/functions/_shared/webhook-utils.ts", () => ({
  enqueueWebhookDeliveries: vi.fn().mockResolvedValue(undefined),
}));

const mockGetCampaignLead = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockGetCampaignCloser = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock("../../supabase/functions/_shared/campaign-distribution.ts", () => ({
  getCampaignLeadAssignment: mockGetCampaignLead,
  getCampaignCloserAssignment: mockGetCampaignCloser,
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

// Response helpers use crypto.randomUUID — available globally in Node 20.

// Mock global fetch for outbound-trigger background call
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

// Import target (triggers serve/capture)
import "../../supabase/functions/lead-webhook/index";

beforeEach(() => {
  clearDenoEnv();
  setDenoEnv("WEBHOOK_API_KEY", "secret");
  setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
  setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "svc-key");
  vi.clearAllMocks();
  state.rpcResults = {};
  mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));

  const { sb, mockTable } = createMockSupabase();
  mockTable("organizations", [{ id: "org-1", name: "Org 1" }]);
  mockTable("team_members", [{ id: "tm-1", organization_id: "org-1", is_active: true }]);
  mockTable("leads", []);
  mockTable("pipe_whatsapp", []);
  mockTable("pipe_confirmacao", []);
  mockTable("pipe_propostas", []);
  mockTable("campanhas", []);
  mockTable("campanha_stages", []);
  mockTable("campanha_leads", []);
  mockTable("tags", []);
  mockTable("lead_tags", []);
  mockTable("lead_custom_fields", []);
  mockTable("lead_custom_field_values", []);
  state.mock = { sb, mockTable } as any;

  mockGetOrCreateLead.mockResolvedValue({
    lead: {
      id: "lead-existing",
      name: "Existing",
      phone: "11999",
      email: "e@x",
      organization_id: "org-1",
      normalized_phone: "5511999",
    },
    created: false,
    source: "found",
  });
});

function invoke(body: unknown, extraHeaders: Record<string, string> = {}) {
  const h = capture.handler;
  if (!h) throw new Error("handler not captured");
  return h(
    new Request("https://x/lead-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-key": "secret", ...extraHeaders },
      body: JSON.stringify(body),
    }),
  );
}

// ─── OPTIONS + auth ──────────────────────────────────────────────────────

describe("lead-webhook — CORS + auth", () => {
  it("handles OPTIONS preflight", async () => {
    const h = capture.handler!;
    const res = await h(new Request("https://x", { method: "OPTIONS" }));
    expect(res.status).toBe(200);
  });

  it("rejects missing webhook key", async () => {
    const h = capture.handler!;
    const res = await h(
      new Request("https://x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { phone: "1" } }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects wrong webhook key", async () => {
    const res = await invoke({ fields: { phone: "1" } }, { "x-webhook-key": "wrong" });
    expect(res.status).toBe(401);
  });
});

// ─── Validation ───────────────────────────────────────────────────────────

describe("lead-webhook — validation", () => {
  it("400 when fields missing phone AND email", async () => {
    const res = await invoke({ source: "meta_ads", fields: { name: "X" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("phone or email");
  });

  it("400 when organization_id is not a UUID", async () => {
    const res = await invoke({
      source: "meta_ads",
      organization_id: "not-a-uuid",
      fields: { phone: "1" },
    });
    expect(res.status).toBe(400);
  });

  it("400 when assigned_user_id is not a UUID", async () => {
    const res = await invoke({
      source: "meta_ads",
      assigned_user_id: "bad",
      fields: { phone: "1" },
    });
    expect(res.status).toBe(400);
  });

  it("400 when place_in_campaign.campaign_id is not a UUID", async () => {
    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "1" },
      place_in_campaign: { campaign_id: "nope", stage_id: "1" },
    });
    expect(res.status).toBe(400);
  });

  it("400 when place_in_campaign.stage_id is not a UUID", async () => {
    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "1" },
      place_in_campaign: {
        campaign_id: "123e4567-e89b-12d3-a456-426614174001",
        stage_id: "bad",
      },
    });
    expect(res.status).toBe(400);
  });

  it("400 when meeting_date is not valid ISO", async () => {
    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "1" },
      place_in_pipe: { pipe: "whatsapp", stage: "novo", meeting_date: "not-iso" },
    });
    expect(res.status).toBe(400);
  });

  it("sanitizes whitespace-only fields to undefined", async () => {
    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "1", name: "   " },
    });
    expect(res.status).toBe(200);
  });
});

// ─── Tag normalization ────────────────────────────────────────────────────

describe("lead-webhook — tag normalization", () => {
  it("accepts tags as array", async () => {
    const res = await invoke({
      source: "meta_ads",
      tags: ["Ouro", "VIP"],
      fields: { phone: "1" },
    });
    expect(res.status).toBe(200);
  });

  it("accepts tags as JSON string", async () => {
    const res = await invoke({
      source: "meta_ads",
      tags: '["Ouro"]',
      fields: { phone: "1" },
    });
    expect(res.status).toBe(200);
  });

  it("accepts tags as simple string", async () => {
    const res = await invoke({
      source: "meta_ads",
      tags: "Ouro",
      fields: { phone: "1" },
    });
    expect(res.status).toBe(200);
  });

  it("parses invalid JSON string as single-tag array", async () => {
    const res = await invoke({
      source: "meta_ads",
      tags: "{not-json",
      fields: { phone: "1" },
    });
    expect(res.status).toBe(200);
  });

  it("400 when tags array exceeds 50 items", async () => {
    const res = await invoke({
      source: "meta_ads",
      tags: Array.from({ length: 51 }, (_, i) => `t${i}`),
      fields: { phone: "1" },
    });
    expect(res.status).toBe(400);
  });
});

// ─── Custom fields ────────────────────────────────────────────────────────

describe("lead-webhook — custom fields", () => {
  it("400 when custom field count > 100", async () => {
    const fields: Record<string, string> = { phone: "1" };
    for (let i = 0; i < 101; i++) fields[`cf${i}`] = "x";
    const res = await invoke({ source: "meta_ads", fields });
    expect(res.status).toBe(400);
  });

  it("saves custom field values", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("organizations", [{ id: "org-1" }]);
    mockTable("leads", []);
    mockTable("pipe_whatsapp", []);
    mockTable("lead_custom_fields", [
      { id: "cf-id", field_name: "cnpj", organization_id: "org-1" },
    ]);
    mockTable("lead_custom_field_values", []);
    state.mock = { sb, mockTable } as any;

    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "1", cnpj: "12345" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.custom_fields?.cnpj).toBe("saved");
  });
});

// ─── Source origin mapping ────────────────────────────────────────────────

describe("lead-webhook — origin mapping", () => {
  for (const source of [
    "meta_ads",
    "Facebook",
    "instagram",
    "tiktok",
    "google_ads",
    "landing_page",
    "site",
    "remarketing",
    "Indicação",
    "referral",
    "evento",
    "event",
    "prospeccao_ativa",
    "prospeccao",
    "outbound",
    "whatsapp",
    "calendly",
    "cal.com",
    "unknown_source",
  ]) {
    it(`accepts source=${source}`, async () => {
      // origin=cal requires meeting_date (Cal.com bypass) — inject for cal sources.
      const isCal = ["cal", "cal.com", "calendly"].includes(source.toLowerCase());
      const fields: Record<string, string> = { phone: "1" };
      if (isCal) fields.meeting_date = "2026-06-01T10:00:00Z";
      const res = await invoke({ source, fields });
      expect(res.status).toBe(200);
    });
  }
});

// ─── update_existing_if_match branches ───────────────────────────────────

describe("lead-webhook — update_existing_if_match", () => {
  it("true: delegates to getOrCreateLead (found existing)", async () => {
    const res = await invoke({
      source: "meta_ads",
      update_existing_if_match: true,
      fields: { phone: "11999" },
    });
    expect(res.status).toBe(200);
    expect(mockGetOrCreateLead).toHaveBeenCalledOnce();
    const body = await res.json();
    expect(body.is_new).toBe(false);
  });

  it("string 'true' also triggers dedup path (n8n compat)", async () => {
    const res = await invoke({
      source: "meta_ads",
      update_existing_if_match: "true",
      fields: { phone: "11999" },
    });
    expect(res.status).toBe(200);
    expect(mockGetOrCreateLead).toHaveBeenCalled();
  });

  it("500 when getOrCreateLead returns null", async () => {
    mockGetOrCreateLead.mockResolvedValueOnce(null);
    const res = await invoke({
      source: "meta_ads",
      update_existing_if_match: true,
      fields: { phone: "11999" },
    });
    expect(res.status).toBe(500);
  });

  it("default path creates new lead without calling getOrCreateLead", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("organizations", [{ id: "org-1" }]);
    mockTable("leads", []);
    mockTable("pipe_whatsapp", []);
    state.mock = { sb, mockTable } as any;

    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "1", name: "New One" },
    });
    expect(res.status).toBe(200);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.is_new).toBe(true);
  });
});

// ─── place_in_pipe paths ─────────────────────────────────────────────────

describe("lead-webhook — place_in_pipe", () => {
  it("places lead in pipe_whatsapp (new row) + triggers auto-distribute", async () => {
    state.rpcResults = { get_next_pipe_sdr: "tm-sdr", get_next_pipe_closer: "tm-closer" };
    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "1" },
      update_existing_if_match: true,
      place_in_pipe: { pipe: "whatsapp", stage: "novo_lead" },
    });
    expect(res.status).toBe(200);
  });

  it("updates existing pipe_whatsapp row", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("organizations", [{ id: "org-1" }]);
    mockTable("leads", []);
    mockTable("pipe_whatsapp", [{ id: "pw-existing", lead_id: "lead-existing", organization_id: "org-1" }]);
    state.mock = { sb, mockTable } as any;

    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "1" },
      update_existing_if_match: true,
      place_in_pipe: { pipe: "whatsapp", stage: "abordado" },
    });
    expect(res.status).toBe(200);
  });

  it("places lead in pipe_confirmacao with meeting_date", async () => {
    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "1" },
      update_existing_if_match: true,
      place_in_pipe: {
        pipe: "confirmacao",
        stage: "reuniao_marcada",
        meeting_date: "2026-06-01T10:00:00Z",
      },
    });
    expect(res.status).toBe(200);
  });

  it("places lead in pipe_propostas (new)", async () => {
    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "1" },
      update_existing_if_match: true,
      place_in_pipe: { pipe: "propostas", stage: "proposta_enviada" },
    });
    expect(res.status).toBe(200);
  });
});

// ─── Cal.com bypass (origin=cal → pipe_confirmacao) ───────────────────────

describe("lead-webhook — Cal.com bypass", () => {
  const meetingDate = "2026-06-01T10:00:00Z";

  it("rejects source=cal without meeting_date", async () => {
    const res = await invoke({
      source: "cal",
      update_existing_if_match: true,
      fields: { phone: "1" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("meeting_date");
  });

  it("rejects source=calendly with invalid meeting_date", async () => {
    const res = await invoke({
      source: "calendly",
      update_existing_if_match: true,
      fields: { phone: "1", meeting_date: "not-iso" },
    });
    expect(res.status).toBe(400);
  });

  it("accepts source=cal with meeting_date in fields", async () => {
    const res = await invoke({
      source: "cal",
      update_existing_if_match: true,
      fields: { phone: "1", meeting_date: meetingDate },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.place_in_pipe?.pipe).toBe("confirmacao");
    expect(body.place_in_pipe?.stage).toBe("reuniao_marcada");
    expect(body.place_in_pipe?.meeting_date).toBe(meetingDate);
  });

  it("accepts source=cal with meeting_date in place_in_pipe", async () => {
    const res = await invoke({
      source: "cal",
      update_existing_if_match: true,
      fields: { phone: "1" },
      place_in_pipe: { pipe: "confirmacao", stage: "reuniao_marcada", meeting_date: meetingDate },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.place_in_pipe?.pipe).toBe("confirmacao");
  });

  it("overrides place_in_pipe when caller mistakenly sends pipe=whatsapp", async () => {
    const res = await invoke({
      source: "cal.com",
      update_existing_if_match: true,
      fields: { phone: "1", meeting_date: meetingDate },
      place_in_pipe: { pipe: "whatsapp", stage: "novo_lead" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.place_in_pipe?.pipe).toBe("confirmacao");
    expect(body.place_in_pipe?.stage).toBe("reuniao_marcada");
  });

  it("does not affect non-cal origins (meta_ads goes normally)", async () => {
    const res = await invoke({
      source: "meta_ads",
      update_existing_if_match: true,
      fields: { phone: "1" },
    });
    expect(res.status).toBe(200);
  });
});

// ─── place_in_campaign paths ─────────────────────────────────────────────

describe("lead-webhook — place_in_campaign", () => {
  const uuid1 = "123e4567-e89b-12d3-a456-426614174001";
  const uuid2 = "123e4567-e89b-12d3-a456-426614174002";

  it("reports error when campaign not found", async () => {
    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "1" },
      update_existing_if_match: true,
      place_in_campaign: { campaign_id: uuid1, stage_id: uuid2 },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.placed_in_campaign).toBe(false);
    expect(body.place_in_campaign_error).toContain("Campaign");
  });

  it("reports error when stage not in campaign", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("organizations", [{ id: "org-1" }]);
    mockTable("campanhas", [{ id: uuid1, organization_id: "org-1" }]);
    mockTable("campanha_stages", []);
    mockTable("campanha_leads", []);
    mockTable("leads", []);
    mockTable("pipe_whatsapp", []);
    state.mock = { sb, mockTable } as any;

    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "1" },
      update_existing_if_match: true,
      place_in_campaign: { campaign_id: uuid1, stage_id: uuid2 },
    });
    const body = await res.json();
    expect(body.placed_in_campaign).toBe(false);
    expect(body.place_in_campaign_error).toContain("Stage");
  });

  it("inserts new campanha_leads when no existing entry", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("organizations", [{ id: "org-1" }]);
    mockTable("campanhas", [{ id: uuid1, organization_id: "org-1" }]);
    mockTable("campanha_stages", [{ id: uuid2, campanha_id: uuid1 }]);
    mockTable("campanha_leads", []);
    mockTable("leads", []);
    mockTable("pipe_whatsapp", []);
    state.mock = { sb, mockTable } as any;
    mockGetCampaignLead.mockResolvedValueOnce("tm-sdr");
    mockGetCampaignCloser.mockResolvedValueOnce("tm-closer");

    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "1" },
      update_existing_if_match: true,
      place_in_campaign: { campaign_id: uuid1, stage_id: uuid2, notes: "hot lead" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.placed_in_campaign).toBe(true);
  });

  it("updates existing campanha_leads entry", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("organizations", [{ id: "org-1" }]);
    mockTable("campanhas", [{ id: uuid1, organization_id: "org-1" }]);
    mockTable("campanha_stages", [{ id: uuid2, campanha_id: uuid1 }]);
    mockTable("campanha_leads", [
      { id: "cl-1", lead_id: "lead-existing", campanha_id: uuid1 },
    ]);
    mockTable("leads", []);
    mockTable("pipe_whatsapp", []);
    state.mock = { sb, mockTable } as any;

    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "1" },
      update_existing_if_match: true,
      place_in_campaign: { campaign_id: uuid1, stage_id: uuid2, notes: "updated" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.placed_in_campaign).toBe(true);
  });
});

// ─── No organization found path ──────────────────────────────────────────

describe("lead-webhook — org resolution", () => {
  it("400 when no organization exists and none passed", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("organizations", []);
    state.mock = { sb, mockTable } as any;

    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "1" },
    });
    expect(res.status).toBe(400);
  });
});

// ─── Catch block ─────────────────────────────────────────────────────────

describe("lead-webhook — catch block", () => {
  it("500 when body is invalid JSON", async () => {
    const h = capture.handler!;
    const res = await h(
      new Request("https://x", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-webhook-key": "secret" },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(500);
  });
});
