/**
 * lead-webhook — contrato D6/D4 da unificação de funis (SCRUM-624).
 *
 * O que este arquivo prova, com o pipeline-adapter REAL rodando sobre o dublê
 * de Supabase (nada do adapter é mockado — o contrato é o comportamento
 * conjunto webhook+adapter):
 *
 *   • `place_in_pipe.pipe` aceita funil CUSTOM por uuid e por slug;
 *   • aliases legados (`pipe_whatsapp`, `qualificacao`) resolvem para os funis
 *     semeados;
 *   • funil inexistente → 4xx ANTES de criar o lead (fim do 200 + descarte);
 *     funil inativo → 409;
 *   • lead SEM place_in_pipe → cai no funil PADRÃO da org
 *     (organizations.default_pipeline_id), na 1ª etapa ativa;
 *   • org SEM funil padrão → lead criado SEM card (comportamento definido);
 *   • runtime_logs grava a INTENÇÃO (place_in_pipe pedido) no payload_snapshot.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

const capture = vi.hoisted(() => ({
  handler: null as null | ((req: Request) => Promise<Response>),
}));

vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({
  serve: (h: (req: Request) => Promise<Response>) => {
    capture.handler = h;
  },
}));

vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_name: string, handler: unknown) => handler,
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

const mockLogRuntime = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: mockLogRuntime,
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
globalThis.fetch = mockFetch as unknown as typeof fetch;

import "../../supabase/functions/lead-webhook/index";
import { __clearPipelineResolutionCache } from "../../supabase/functions/_shared/pipeline-adapter";

const ORG = "org-1";
const PIPE_WA = "aaaaaaaa-0000-4000-8000-0000000000a1";
const PIPE_CUSTOM = "aaaaaaaa-0000-4000-8000-0000000000c1";
const PIPE_MORTO = "aaaaaaaa-0000-4000-8000-0000000000d1";

function seedTables(opts: { defaultPipelineId?: string | null } = {}) {
  const { sb, mockTable, getInserted, getUpdated } = createMockSupabase();
  mockTable("organizations", [
    { id: ORG, name: "Org 1", default_pipeline_id: opts.defaultPipelineId ?? null },
  ]);
  mockTable("team_members", []);
  mockTable("leads", []);
  mockTable("pipelines", [
    { id: PIPE_WA, organization_id: ORG, slug: "whatsapp", name: "Oportunidades", type: "system", is_active: true },
    { id: PIPE_CUSTOM, organization_id: ORG, slug: "pos-venda", name: "Pós-venda", type: "custom", is_active: true },
    { id: PIPE_MORTO, organization_id: ORG, slug: "descontinuado", name: "Descontinuado", type: "custom", is_active: false },
  ]);
  mockTable("pipeline_stages", [
    { organization_id: ORG, pipeline_id: PIPE_CUSTOM, stage_key: "kickoff", name: "Kickoff", is_active: true, position: 0 },
    { organization_id: ORG, pipeline_id: PIPE_CUSTOM, stage_key: "entrega", name: "Entrega", is_active: true, position: 1 },
    { organization_id: ORG, pipeline_id: PIPE_WA, stage_key: "novo_lead", name: "Novo Lead", is_active: true, position: 0 },
  ]);
  mockTable("pipeline_entries", []);
  mockTable("tags", []);
  mockTable("lead_tags", []);
  mockTable("lead_custom_fields", []);
  mockTable("lead_custom_field_values", []);
  state.mock = { sb, mockTable, getInserted, getUpdated } as unknown as ReturnType<typeof createMockSupabase>;
  return { getInserted, getUpdated };
}

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

/** As tasks de background (logRuntime, outbound) rodam sem await — drena a fila. */
async function flushBackground() {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  __clearPipelineResolutionCache();
  clearDenoEnv();
  setDenoEnv("WEBHOOK_API_KEY", "secret");
  setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
  setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "svc-key");
  vi.clearAllMocks();
  mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));
});

describe("lead-webhook — destino em funil custom (D6)", () => {
  it("posiciona em funil custom por UUID", async () => {
    const { getInserted } = seedTables();
    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "11999" },
      place_in_pipe: { pipe: PIPE_CUSTOM, stage: "entrega" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.placed_in_pipe).toBe(true);
    const entries = getInserted("pipeline_entries");
    const placed = entries.find((e) => e.pipeline_id === PIPE_CUSTOM);
    expect(placed).toBeTruthy();
    expect(placed?.stage_key).toBe("entrega");
  });

  it("posiciona em funil custom por SLUG", async () => {
    const { getInserted } = seedTables();
    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "11999" },
      place_in_pipe: { pipe: "pos-venda", stage: "kickoff" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.placed_in_pipe).toBe(true);
    const placed = getInserted("pipeline_entries").find((e) => e.pipeline_id === PIPE_CUSTOM);
    expect(placed).toBeTruthy();
    expect(placed?.stage_key).toBe("kickoff");
  });

  it("alias legado (pipe_whatsapp) resolve para o funil semeado", async () => {
    const { getInserted } = seedTables();
    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "11999" },
      place_in_pipe: { pipe: "pipe_whatsapp", stage: "novo_lead" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.placed_in_pipe).toBe(true);
    const placed = getInserted("pipeline_entries").find((e) => e.pipeline_id === PIPE_WA);
    expect(placed).toBeTruthy();
    expect(placed?.stage_key).toBe("novo_lead");
  });

  it("stage inexistente em funil custom remapeia para a 1ª etapa ativa (ghost-stage guard)", async () => {
    const { getInserted } = seedTables();
    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "11999" },
      place_in_pipe: { pipe: "pos-venda", stage: "etapa_que_nao_existe" },
    });
    expect(res.status).toBe(200);
    const placed = getInserted("pipeline_entries").find((e) => e.pipeline_id === PIPE_CUSTOM);
    expect(placed?.stage_key).toBe("kickoff");
  });
});

describe("lead-webhook — funil que não resolve erra ALTO e ANTES (D6)", () => {
  it("funil inexistente → 404 SEM criar o lead", async () => {
    const { getInserted } = seedTables();
    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "11999" },
      place_in_pipe: { pipe: "funil-fantasma", stage: "novo" },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/não existe nesta organização/);
    // O 4xx tem de acontecer ANTES de qualquer escrita: sem lead, sem card.
    expect(getInserted("leads")).toHaveLength(0);
    expect(getInserted("pipeline_entries")).toHaveLength(0);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  it("funil inativo → 409 sem criar o lead", async () => {
    const { getInserted } = seedTables();
    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "11999" },
      place_in_pipe: { pipe: "descontinuado", stage: "novo" },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/inativo/);
    expect(getInserted("leads")).toHaveLength(0);
  });
});

describe("lead-webhook — funil padrão da org (D4)", () => {
  it("lead SEM place_in_pipe cai no funil padrão, na 1ª etapa ativa", async () => {
    const { getInserted } = seedTables({ defaultPipelineId: PIPE_CUSTOM });
    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "11999", name: "Sem Destino" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.is_new).toBe(true);
    const seeded = getInserted("pipeline_entries").find((e) => e.pipeline_id === PIPE_CUSTOM);
    expect(seeded).toBeTruthy();
    expect(seeded?.stage_key).toBe("kickoff"); // 1ª ativa (position 0)
    // Nada foi semeado no funil whatsapp — o hardcode morreu.
    expect(getInserted("pipeline_entries").some((e) => e.pipeline_id === PIPE_WA)).toBe(false);
  });

  it("org SEM funil padrão: lead criado SEM card (comportamento definido)", async () => {
    const { getInserted } = seedTables({ defaultPipelineId: null });
    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "11999", name: "Sem Card" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.is_new).toBe(true);
    expect(body.lead_id).toBeTruthy();
    expect(getInserted("pipeline_entries")).toHaveLength(0);
  });

  it("caminho deduplicado com lead NOVO também semeia o funil padrão", async () => {
    const { getInserted } = seedTables({ defaultPipelineId: PIPE_CUSTOM });
    mockGetOrCreateLead.mockResolvedValue({
      lead: { id: "lead-novo", name: "X", phone: "11999", email: null, organization_id: ORG },
      created: true,
      source: "created",
    });
    const res = await invoke({
      source: "meta_ads",
      update_existing_if_match: true,
      fields: { phone: "11999" },
    });
    expect(res.status).toBe(200);
    // lead-service não semeia mais (skipPipeSeed: true) — a porta semeia.
    expect(mockGetOrCreateLead.mock.calls[0][1]).toMatchObject({ skipPipeSeed: true });
    const seeded = getInserted("pipeline_entries").find((e) => e.pipeline_id === PIPE_CUSTOM);
    expect(seeded).toBeTruthy();
  });

  it("caminho deduplicado com lead EXISTENTE não ressemeia", async () => {
    const { getInserted } = seedTables({ defaultPipelineId: PIPE_CUSTOM });
    mockGetOrCreateLead.mockResolvedValue({
      lead: { id: "lead-velho", name: "X", phone: "11999", email: null, organization_id: ORG },
      created: false,
      source: "phone",
    });
    const res = await invoke({
      source: "meta_ads",
      update_existing_if_match: true,
      fields: { phone: "11999" },
    });
    expect(res.status).toBe(200);
    expect(getInserted("pipeline_entries")).toHaveLength(0);
  });
});

describe("lead-webhook — snapshot mede a intenção (D6)", () => {
  it("payload_snapshot grava o place_in_pipe PEDIDO e o desfecho", async () => {
    seedTables();
    const res = await invoke({
      source: "meta_ads",
      fields: { phone: "11999" },
      place_in_pipe: { pipe: "pos-venda", stage: "entrega" },
    });
    expect(res.status).toBe(200);
    await flushBackground();
    const call = mockLogRuntime.mock.calls.find(
      (c) => (c[0] as { action?: string } | undefined)?.action === "webhook_ingest",
    );
    expect(call).toBeTruthy();
    const snap = (call![0] as { payloadSnapshot: Record<string, unknown> }).payloadSnapshot;
    expect(snap.place_in_pipe).toEqual({ pipe: "pos-venda", stage: "entrega" });
    expect(snap.placed_in_pipe).toBe(true);
    expect(snap.resolved_pipeline_id).toBe(PIPE_CUSTOM);
  });

  it("sem place_in_pipe o snapshot grava intenção nula", async () => {
    seedTables({ defaultPipelineId: PIPE_WA });
    const res = await invoke({ source: "meta_ads", fields: { phone: "11999" } });
    expect(res.status).toBe(200);
    await flushBackground();
    const call = mockLogRuntime.mock.calls.find(
      (c) => (c[0] as { action?: string } | undefined)?.action === "webhook_ingest",
    );
    const snap = (call![0] as { payloadSnapshot: Record<string, unknown> }).payloadSnapshot;
    expect(snap.place_in_pipe).toBeNull();
  });
});
