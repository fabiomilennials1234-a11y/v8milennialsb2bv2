/**
 * Coverage for evaluateCondition + private helpers (getCustomFieldValue,
 * getLeadTags). Complements workflow-condition-evaluator.test.ts which
 * covers the pure `compare()` function.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ADR-0023 §10: `field: "stage"` resolve a etapa do NEGÓCIO via
// `getPipeEntry(..., "whatsapp")`, não mais de `leads.pipe_whatsapp` — o espelho
// legado congela quando o negócio sai de Oportunidades por UPDATE, e uma condição
// comparando etapa passaria a casar sempre contra estado que não existe mais.
const { pipeEntries } = vi.hoisted(() => ({ pipeEntries: {} as Record<string, unknown> }));

vi.mock("../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  getPipeEntry: vi.fn(
    async (_sb: unknown, _leadId: string, _orgId: string, slug: string) => pipeEntries[slug] ?? null,
  ),
  getPipeEntriesByLeads: vi.fn().mockResolvedValue([]),
  // SCRUM-623: o contrato novo LANÇA em funil não resolvido — null saiu do tipo.
  resolvePipelineId: vi.fn(async () => {
    throw new Error("pipeline_not_found (mock — contrato SCRUM-623 lança, não devolve null)");
  }),
  tryResolvePipelineId: vi.fn().mockResolvedValue(null),
}));

import { evaluateCondition } from "../../supabase/functions/_shared/workflow-condition-evaluator";
import { createMockSupabase } from "../helpers/supabase-mock";

// Sem `pipe_whatsapp`: a coluna saiu do caminho de leitura, e mantê-la no fixture
// esconderia uma regressão — o teste passaria de novo se alguém a reintroduzisse.
const LEAD = {
  id: "lead-1",
  organization_id: "org-1",
  name: "Ada",
  email: "ada@x.com",
  qualification_score: 82,
  rating: 4,
  segment: "B2B",
};

beforeEach(() => {
  for (const k of Object.keys(pipeEntries)) delete pipeEntries[k];
});

describe("evaluateCondition — lead lookup", () => {
  it("returns false when lead not found", async () => {
    const { sb } = createMockSupabase();
    const result = await evaluateCondition(sb, "missing", {
      field: "name",
      operator: "equals",
      value: "Ada",
    });
    expect(result).toBe(false);
  });
});

describe("evaluateCondition — field resolution", () => {
  it("resolves default field from lead row", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "segment",
      operator: "equals",
      value: "B2B",
    });
    expect(result).toBe(true);
  });

  it("field='stage' resolve a etapa do negócio corrente (ADR-0031: aberto > mais recente)", async () => {
    // SCRUM-627: o fallback sem entry declarada deixou de ser o card de
    // Oportunidades chumbado — é o negócio corrente em QUALQUER funil.
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("pipeline_entries", [
      { id: "entry-1", lead_id: "lead-1", organization_id: "org-1", stage_key: "abordado", closed_at: null },
    ]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "stage",
      operator: "in_stage",
      value: "abordado",
    });
    expect(result).toBe(true);
  });

  it("SCRUM-627: condição de etapa casa em funil CUSTOM sem card de Oportunidades", async () => {
    // O caso que mentia: workflow de funil custom, lead sem card de whatsapp.
    // O fallback antigo respondia "" e a condição decidia pelo motivo errado.
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("pipeline_entries", [
      { id: "entry-c1", lead_id: "lead-1", organization_id: "org-1", pipeline_id: "pipe-custom-1", stage_key: "triagem", closed_at: null },
    ]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "stage",
      operator: "in_stage",
      value: "triagem",
    });
    expect(result).toBe(true);
  });

  it("SCRUM-627: entry declarada no contexto vence o fallback", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("pipeline_entries", [
      { id: "entry-a", lead_id: "lead-1", organization_id: "org-1", stage_key: "aberta", closed_at: null },
      { id: "entry-b", lead_id: "lead-1", organization_id: "org-1", stage_key: "proposta_enviada", closed_at: null },
    ]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "stage",
      operator: "in_stage",
      value: "proposta_enviada",
    }, "entry-b");
    expect(result).toBe(true);
  });

  it("field='stage' ignora a coluna legada leads.pipe_whatsapp", async () => {
    // Sem negócio no funil, mas com o espelho legado carregando valor: é
    // exatamente o estado em que a coluna fica DEPOIS do move (ela congela, não
    // esvazia). A condição tem de tratar como "sem etapa", não casar com o
    // valor velho.
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ ...LEAD, pipe_whatsapp: "abordado" }]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "stage",
      operator: "in_stage",
      value: "abordado",
    });
    expect(result).toBe(false);
  });

  it("field='stage' cai para string vazia quando o lead não tem negócio no funil", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", organization_id: "org-1" }]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "stage",
      operator: "is_empty",
      value: "",
    });
    expect(result).toBe(true);
  });

  it("field='score' maps to qualification_score", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "score",
      operator: "greater_than",
      value: "80",
    });
    expect(result).toBe(true);
  });

  it("field='score' defaults to 0 when qualification_score null", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", organization_id: "org-1" }]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "score",
      operator: "equals",
      value: "0",
    });
    expect(result).toBe(true);
  });

  it("unknown non-prefix field returns undefined → is_empty=true", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "nonexistent_field",
      operator: "is_empty",
      value: "",
    });
    expect(result).toBe(true);
  });
});

describe("evaluateCondition — tags field", () => {
  it("returns joined tag names for has_tag", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("lead_tags", [
      { lead_id: "lead-1", tag: { name: "Ouro" } },
      { lead_id: "lead-1", tag: { name: "VIP" } },
    ]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "tags",
      operator: "has_tag",
      value: "ouro",
    });
    expect(result).toBe(true);
  });

  it("returns empty when lead has no tags", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("lead_tags", []);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "tags",
      operator: "is_empty",
      value: "",
    });
    expect(result).toBe(true);
  });

  it("skips tags with null name", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("lead_tags", [
      { lead_id: "lead-1", tag: { name: "Ouro" } },
      { lead_id: "lead-1", tag: null },
    ]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "tags",
      operator: "contains",
      value: "ouro",
    });
    expect(result).toBe(true);
  });
});

describe("evaluateCondition — custom fields", () => {
  it("resolves custom.cnpj via lookup + value", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("lead_custom_fields", [
      { id: "cf-cnpj", organization_id: "org-1", field_name: "cnpj" },
    ]);
    mockTable("lead_custom_field_values", [
      { lead_id: "lead-1", field_id: "cf-cnpj", value: "12.345.678/0001-90" },
    ]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "custom.cnpj",
      operator: "contains",
      value: "12.345",
    });
    expect(result).toBe(true);
  });

  it("returns empty string when custom field not defined", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("lead_custom_fields", []);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "custom.nope",
      operator: "is_empty",
      value: "",
    });
    expect(result).toBe(true);
  });

  it("returns empty when value row missing", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("lead_custom_fields", [
      { id: "cf-vazio", organization_id: "org-1", field_name: "vazio" },
    ]);
    mockTable("lead_custom_field_values", []);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "custom.vazio",
      operator: "is_empty",
      value: "",
    });
    expect(result).toBe(true);
  });

  it("returns empty when organization_id missing on lead", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", name: "Orphan" }]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "custom.any",
      operator: "is_empty",
      value: "",
    });
    expect(result).toBe(true);
  });
});
