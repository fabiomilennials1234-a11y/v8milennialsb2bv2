/**
 * LeadProfileBuilder — enriched lead data for copilot prompt injection.
 * Extracted from context-loader.ts loadLeadData.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubGlobal("Deno", {
  env: {
    get: (k: string) => ({ SUPABASE_URL: "https://local.test", SUPABASE_SERVICE_ROLE_KEY: "svc-role" }[k]),
    toObject: () => ({}),
  },
  serve: () => {},
});

vi.mock("../../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_n: string, fn: unknown) => fn,
  logError: vi.fn(async () => {}),
  logEvent: vi.fn(async () => {}),
}));
vi.mock("../../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn(async () => {}),
  redactSecrets: (v: unknown) => v,
}));
// Entries por slug de funil. Mock posicional (`mockResolvedValueOnce` em sequência)
// não serve mais: ADR-0023 §10 acrescentou a leitura do funil WhatsApp ao mesmo
// `Promise.all`, e qualquer nova leitura embaralharia a ordem de novo.
const { pipeEntries } = vi.hoisted(() => ({
  pipeEntries: {} as Record<string, unknown>,
}));

vi.mock("../../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  getPipeEntry: vi.fn(
    async (_sb: unknown, _leadId: string, _orgId: string, slug: string) => pipeEntries[slug] ?? null,
  ),
  getPipeEntriesByLeads: vi.fn().mockResolvedValue([]),
  resolvePipelineId: vi.fn().mockResolvedValue(null),
}));

import { LeadProfileBuilder } from "../../../supabase/functions/_shared/copilot/lead-profile-builder.ts";

const LEAD_ROW = {
  id: "lead-1",
  name: "João Silva",
  phone: "5511999990000",
  email: "joao@test.com",
  company: "ACME",
  origin: "meta_ads",
  rating: 4,
  segment: "industrial",
  faturamento: 500000,
  urgency: "alta",
  notes: "Big potential",
  organization_id: "org-1",
  created_at: "2026-01-01",
  updated_at: "2026-05-01",
};

function buildSupabase(opts: {
  lead?: any;
  customFields?: any[];
  upsell?: any;
  campanha?: any;
} = {}) {
  const { lead = LEAD_ROW, customFields = [], upsell = null, campanha = null } = opts;

  const sb: any = {
    from: vi.fn((table: string) => {
      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        single: vi.fn(() => {
          if (table === "leads") return Promise.resolve({ data: lead, error: null });
          return Promise.resolve({ data: null, error: null });
        }),
        maybeSingle: vi.fn(() => {
          if (table === "upsell_clients") return Promise.resolve({ data: upsell, error: null });
          if (table === "campanha_leads") return Promise.resolve({ data: campanha, error: null });
          return Promise.resolve({ data: null, error: null });
        }),
        then: (r: any) => {
          if (table === "lead_custom_field_values") {
            return r({ data: customFields, error: null });
          }
          return r({ data: null, error: null });
        },
      };
      return builder;
    }),
  };
  return sb;
}

describe("LeadProfileBuilder", () => {
  beforeEach(() => {
    for (const k of Object.keys(pipeEntries)) delete pipeEntries[k];
  });

  it("expõe a etapa do funil WhatsApp como whatsapp_status, vinda do negócio", async () => {
    pipeEntries.whatsapp = { id: "entry-wa", stage_key: "abordado", metadata: {} };

    const sb = buildSupabase();
    const profile = await new LeadProfileBuilder(sb).build("lead-1");

    expect(profile!.whatsapp_status).toBe("abordado");
    // O espelho legado saiu do SELECT: nenhum consumidor do perfil pode cair nele
    // sem perceber depois que o gatilho de L2 passar a zerá-lo.
    expect(profile!.pipe_whatsapp).toBeUndefined();
  });

  it("deixa whatsapp_status nulo quando o lead não tem negócio no funil", async () => {
    const sb = buildSupabase();
    const profile = await new LeadProfileBuilder(sb).build("lead-1");

    expect(profile!.whatsapp_status).toBeNull();
  });

  it("builds enriched profile with basic lead data", async () => {
    const sb = buildSupabase();
    const builder = new LeadProfileBuilder(sb);
    const profile = await builder.build("lead-1");

    expect(profile).not.toBeNull();
    expect(profile!.name).toBe("João Silva");
    expect(profile!.company).toBe("ACME");
    expect(profile!.is_existing_client).toBe(false);
  });

  it("includes custom fields", async () => {
    const sb = buildSupabase({
      customFields: [
        { value: "50 funcionários", field: { field_name: "porte", field_type: "text" } },
        { value: "SP", field: { field_name: "estado", field_type: "text" } },
      ],
    });

    const builder = new LeadProfileBuilder(sb);
    const profile = await builder.build("lead-1");

    expect(profile!.customFields).toEqual({ porte: "50 funcionários", estado: "SP" });
  });

  it("includes upsell data", async () => {
    const sb = buildSupabase({
      upsell: { tipo_cliente_tempo: "ativo_6m", gestao_stage: "expansao", potencial: "alto", is_active: true },
    });

    const builder = new LeadProfileBuilder(sb);
    const profile = await builder.build("lead-1");

    expect(profile!.upsell_base_stage).toBe("ativo_6m");
    expect(profile!.upsell_gestao_stage).toBe("expansao");
  });

  it("marks is_existing_client=true when closed deals exist", async () => {
    pipeEntries.propostas = {
      id: "entry-1",
      stage_key: "vendido",
      metadata: { sale_value: 10000, product_type: "mrr" },
      closed_at: "2026-04-01",
      created_at: "2026-03-01",
    };

    const sb = buildSupabase();
    const builder = new LeadProfileBuilder(sb);
    const profile = await builder.build("lead-1");

    expect(profile!.is_existing_client).toBe(true);
    expect(profile!.closed_deals).toHaveLength(1);
  });

  it("returns null when lead not found", async () => {
    const sb = buildSupabase({ lead: null });
    // Override single to return error
    sb.from = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    }));

    const builder = new LeadProfileBuilder(sb);
    const profile = await builder.build("nonexistent");

    expect(profile).toBeNull();
  });

  it("handles empty custom fields gracefully", async () => {
    const sb = buildSupabase({ customFields: [] });

    const builder = new LeadProfileBuilder(sb);
    const profile = await builder.build("lead-1");

    expect(profile!.customFields).toEqual({});
  });
});
