import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// --- Mocks ---

const mockParseFn = vi.fn();
vi.mock("papaparse", () => ({
  default: { parse: (...args: any[]) => mockParseFn(...args) },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: (fn: any) => Promise.resolve(fn({ data: [], error: null })),
    }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
  },
}));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-test" }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

import {
  KNOWN_LEAD_FIELDS,
  resolveSellerToId,
  resolveProductToId,
  resolveStageFromName,
  parseFilePreview,
  parseExcelSheetNames,
  parseFileToRows,
  useImportLeads,
  type FilePreviewResult,
  type FunnelDestination,
  type EdgeFunctionReport,
  type ImportLeadsToFunnelOptions,
  type ImportLeadsToCustomPipelineOptions,
} from "@/modules/leads";

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ─── KNOWN_LEAD_FIELDS ───

describe("KNOWN_LEAD_FIELDS", () => {
  it("has at least 20 known fields", () => {
    expect(KNOWN_LEAD_FIELDS.length).toBeGreaterThanOrEqual(20);
  });

  it("includes essential fields", () => {
    const fields = [...KNOWN_LEAD_FIELDS];
    expect(fields).toContain("name");
    expect(fields).toContain("email");
    expect(fields).toContain("phone");
    expect(fields).toContain("company");
  });

  it("includes UTM fields", () => {
    const fields = [...KNOWN_LEAD_FIELDS];
    expect(fields).toContain("utm_campaign");
    expect(fields).toContain("utm_source");
    expect(fields).toContain("utm_medium");
  });

  it("includes funnel fields", () => {
    const fields = [...KNOWN_LEAD_FIELDS];
    expect(fields).toContain("stage");
    expect(fields).toContain("vendedor");
    expect(fields).toContain("valor");
    expect(fields).toContain("produto");
  });

  it("no duplicate fields", () => {
    const fields = [...KNOWN_LEAD_FIELDS];
    expect(new Set(fields).size).toBe(fields.length);
  });

  it("includes data_compromisso and tempo_contrato", () => {
    const fields = [...KNOWN_LEAD_FIELDS];
    expect(fields).toContain("data_compromisso");
    expect(fields).toContain("tempo_contrato");
    expect(fields).toContain("observacoes_etapa");
  });
});

// ─── resolveSellerToId ───

describe("resolveSellerToId", () => {
  const members = [
    { id: "m1", name: "João Silva" },
    { id: "m2", name: "Maria Santos" },
    { id: "m3", name: "Pedro Oliveira" },
  ];

  it("returns defaultId when sellerName is undefined", () => {
    expect(resolveSellerToId(undefined, members, "default")).toBe("default");
  });

  it("returns defaultId when sellerName is empty", () => {
    expect(resolveSellerToId("", members, "default")).toBe("default");
  });

  it("returns defaultId when sellerName is whitespace only", () => {
    expect(resolveSellerToId("   ", members, "default")).toBe("default");
  });

  it("returns defaultId when members is empty", () => {
    expect(resolveSellerToId("João", [], "default")).toBe("default");
  });

  it("matches exact name (case-insensitive, accent-insensitive)", () => {
    expect(resolveSellerToId("joao silva", members, null)).toBe("m1");
  });

  it("matches exact name with accents", () => {
    expect(resolveSellerToId("João Silva", members, null)).toBe("m1");
  });

  it("matches by contains (partial name)", () => {
    expect(resolveSellerToId("Maria", members, null)).toBe("m2");
  });

  it("matches by contains (member contains input)", () => {
    expect(resolveSellerToId("Santos", members, null)).toBe("m2");
  });

  it("falls back to closest by length when no exact or contains match", () => {
    // "Ana" doesn't match any name exactly or by contains
    // Closest by length difference: all names are long, "Ana" is 3 chars
    const result = resolveSellerToId("Ana", members, null);
    expect(result).toBeTruthy();
    // Should return one of the members (closest by string length)
    expect(["m1", "m2", "m3"]).toContain(result);
  });

  it("returns null defaultId when no match", () => {
    expect(resolveSellerToId("Xyz", [], null)).toBeNull();
  });

  it("handles members with empty names", () => {
    const membersWithEmpty = [{ id: "m1", name: "" }, { id: "m2", name: "Maria" }];
    expect(resolveSellerToId("Maria", membersWithEmpty, null)).toBe("m2");
  });
});

// ─── resolveProductToId ───

describe("resolveProductToId", () => {
  const products = [
    { id: "p1", name: "Software CRM" },
    { id: "p2", name: "Consultoria Avançada" },
    { id: "p3", name: "Treinamento" },
  ];

  it("returns defaultId when products is empty", () => {
    expect(resolveProductToId("Test", [], "default")).toBe("default");
  });

  it("returns defaultId when productName is undefined", () => {
    expect(resolveProductToId(undefined, products, "default")).toBe("default");
  });

  it("returns defaultId when productName is empty string", () => {
    expect(resolveProductToId("", products, "default")).toBe("default");
  });

  it("returns defaultId when productName is whitespace", () => {
    expect(resolveProductToId("   ", products, "default")).toBe("default");
  });

  it("matches exact name (case-insensitive, accent-insensitive)", () => {
    expect(resolveProductToId("software crm", products, null)).toBe("p1");
  });

  it("matches by startsWith", () => {
    expect(resolveProductToId("Software", products, null)).toBe("p1");
  });

  it("matches by startsWith (product starts with input)", () => {
    expect(resolveProductToId("Consultoria Avançada Premium", products, null)).toBe("p2");
  });

  it("matches by contains", () => {
    expect(resolveProductToId("CRM", products, null)).toBe("p1");
  });

  it("falls back to closest by length", () => {
    // No exact/startsWith/contains match
    const result = resolveProductToId("Xyz123", products, null);
    expect(result).toBeTruthy();
  });

  it("returns null default when no products and productName given", () => {
    expect(resolveProductToId("Test", [], null)).toBeNull();
  });

  it("handles products with empty names", () => {
    const prods = [{ id: "p1", name: "" }, { id: "p2", name: "Real Product" }];
    expect(resolveProductToId("Real Product", prods, null)).toBe("p2");
  });
});

// ─── resolveStageFromName ───

describe("resolveStageFromName", () => {
  const stages = [
    { stage_key: "novo", name: "Novo" },
    { stage_key: "abordado", name: "Abordado" },
    { stage_key: "respondeu", name: "Respondeu" },
    { stage_key: "reuniao_marcada", name: "Reunião Marcada" },
    { stage_key: "confirmar_d5", name: "Confirmar D-5" },
    { stage_key: "vendido", name: "Vendido ✓" },
    { stage_key: "perdido", name: "Perdido ✗" },
  ];

  it("returns defaultStageKey when stageName is undefined", () => {
    expect(resolveStageFromName(undefined, stages, "novo")).toBe("novo");
  });

  it("returns defaultStageKey when stageName is empty", () => {
    expect(resolveStageFromName("", stages, "novo")).toBe("novo");
  });

  it("returns defaultStageKey when stageName is whitespace", () => {
    expect(resolveStageFromName("   ", stages, "novo")).toBe("novo");
  });

  it("matches exact stage name (case-insensitive)", () => {
    expect(resolveStageFromName("Novo", stages, "fallback")).toBe("novo");
  });

  it("matches exact stage_key", () => {
    expect(resolveStageFromName("abordado", stages, "fallback")).toBe("abordado");
  });

  it("matches with accent removal", () => {
    expect(resolveStageFromName("Reuniao Marcada", stages, "fallback")).toBe("reuniao_marcada");
  });

  it("matches by inclusion (partial name)", () => {
    expect(resolveStageFromName("Reunião", stages, "fallback")).toBe("reuniao_marcada");
  });

  it("matches stage with special chars (✓/✗ stripped)", () => {
    expect(resolveStageFromName("Vendido", stages, "fallback")).toBe("vendido");
  });

  it("matches by startsWith", () => {
    expect(resolveStageFromName("Confirmar", stages, "fallback")).toBe("confirmar_d5");
  });

  it("matches D-5 with D5 (dash normalized)", () => {
    expect(resolveStageFromName("Confirmar D5", stages, "fallback")).toBe("confirmar_d5");
  });

  it("returns default when no match at all", () => {
    expect(resolveStageFromName("Xyz Nonexistent", stages, "novo")).toBe("novo");
  });

  it("matches stage_key with underscores (normalized to spaces)", () => {
    expect(resolveStageFromName("confirmar d5", stages, "fallback")).toBe("confirmar_d5");
  });
});

// ─── parseExcelSheetNames ───

describe("parseExcelSheetNames", () => {
  it("returns ['CSV'] for CSV files", async () => {
    const file = new File(["a,b\n1,2"], "data.csv", { type: "text/csv" });
    const result = await parseExcelSheetNames(file);
    expect(result).toEqual(["CSV"]);
  });

  it("returns [] for unknown file types", async () => {
    const file = new File(["data"], "data.txt", { type: "text/plain" });
    const result = await parseExcelSheetNames(file);
    expect(result).toEqual([]);
  });
});

// ─── parseFileToRows ───

describe("parseFileToRows", () => {
  it("parses CSV file using Papa.parse", async () => {
    const file = new File(["nome,email\nJoão,joao@test.com"], "leads.csv", { type: "text/csv" });

    mockParseFn.mockImplementation((_file: File, opts: any) => {
      opts.complete({ data: [{ nome: "João", email: "joao@test.com" }], errors: [] });
    });

    const result = await parseFileToRows(file);
    expect(result).toEqual([{ nome: "João", email: "joao@test.com" }]);
  });

  it("rejects for unknown file types", async () => {
    const file = new File(["data"], "data.txt", { type: "text/plain" });
    await expect(parseFileToRows(file)).rejects.toThrow("Formato não suportado");
  });
});

// ─── parseFilePreview ───

describe("parseFilePreview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty result for files with no rows", async () => {
    mockParseFn.mockImplementation((_file: File, opts: any) => {
      opts.complete({ data: [], errors: [] });
    });

    const file = new File([""], "empty.csv", { type: "text/csv" });
    const result = await parseFilePreview(file);
    expect(result.columns).toEqual([]);
    expect(result.sampleRows).toEqual([]);
    expect(result.totalRows).toBe(0);
    expect(result.suggestedMapping).toEqual({});
    expect(result.unmappedColumns).toEqual([]);
  });

  it("suggests mapping for known headers", async () => {
    mockParseFn.mockImplementation((_file: File, opts: any) => {
      opts.complete({
        data: [{ "Nome": "João", "Empresa": "Acme", "Telefone": "11999999999", "Custom Col": "val" }],
        errors: [],
      });
    });

    const file = new File(["Nome,Empresa,Telefone,Custom Col\nJoão,Acme,11999999999,val"], "leads.csv");
    const result = await parseFilePreview(file);

    expect(result.columns).toContain("Nome");
    expect(result.columns).toContain("Empresa");
    expect(result.columns).toContain("Telefone");
    expect(result.suggestedMapping["Nome"]).toBe("name");
    expect(result.suggestedMapping["Empresa"]).toBe("company");
    expect(result.suggestedMapping["Telefone"]).toBe("phone");
    expect(result.unmappedColumns).toContain("Custom Col");
    expect(result.totalRows).toBe(1);
    expect(result.sampleRows).toHaveLength(1);
  });

  it("maps custom field names", async () => {
    mockParseFn.mockImplementation((_file: File, opts: any) => {
      opts.complete({
        data: [{ "Tipo Negócio": "B2B" }],
        errors: [],
      });
    });

    const file = new File(["Tipo Negócio\nB2B"], "leads.csv");
    const result = await parseFilePreview(file, ["Tipo Negócio"]);

    expect(result.suggestedMapping["Tipo Negócio"]).toBe("custom:Tipo Negócio");
    expect(result.unmappedColumns).toHaveLength(0);
  });

  it("maps email and utm headers", async () => {
    mockParseFn.mockImplementation((_file: File, opts: any) => {
      opts.complete({
        data: [{ "E-mail": "a@b.com", "Utm Campaign": "camp1", "Origem": "meta" }],
        errors: [],
      });
    });

    const file = new File(["E-mail,Utm Campaign,Origem\na@b.com,camp1,meta"], "leads.csv");
    const result = await parseFilePreview(file);

    expect(result.suggestedMapping["E-mail"]).toBe("email");
    expect(result.suggestedMapping["Utm Campaign"]).toBe("utm_campaign");
    expect(result.suggestedMapping["Origem"]).toBe("origin");
  });

  it("maps vendor/seller headers", async () => {
    mockParseFn.mockImplementation((_file: File, opts: any) => {
      opts.complete({
        data: [{ "Vendedor": "João", "Etapa": "Novo" }],
        errors: [],
      });
    });

    const file = new File(["Vendedor,Etapa\nJoão,Novo"], "leads.csv");
    const result = await parseFilePreview(file);

    expect(result.suggestedMapping["Vendedor"]).toBe("vendedor");
    expect(result.suggestedMapping["Etapa"]).toBe("stage");
  });

  it("includes knownFields with custom fields", async () => {
    mockParseFn.mockImplementation((_f: File, opts: any) => {
      opts.complete({ data: [{ "a": "1" }], errors: [] });
    });
    const file = new File(["a\n1"], "leads.csv");
    const result = await parseFilePreview(file, ["MyCustom"]);
    expect(result.knownFields).toContain("MyCustom");
    expect(result.knownFields).toContain("name");
  });

  it("limits sample rows to 10", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ Nome: `Lead ${i}` }));
    mockParseFn.mockImplementation((_f: File, opts: any) => {
      opts.complete({ data: rows, errors: [] });
    });
    const file = new File(["..."], "leads.csv");
    const result = await parseFilePreview(file);
    expect(result.sampleRows).toHaveLength(10);
    expect(result.totalRows).toBe(20);
  });
});

// ─── useImportLeads hook ───

describe("useImportLeads", () => {
  it("returns initial state", () => {
    const { result } = renderHook(() => useImportLeads(), { wrapper: createWrapper() });
    expect(result.current.isImporting).toBe(false);
    expect(result.current.progress).toBe(0);
    expect(result.current.result).toBeNull();
    expect(result.current.lastReport).toBeNull();
  });

  it("exposes importLeadsToFunnel function", () => {
    const { result } = renderHook(() => useImportLeads(), { wrapper: createWrapper() });
    expect(typeof result.current.importLeadsToFunnel).toBe("function");
  });

  it("exposes importLeadsToCustomPipeline function", () => {
    const { result } = renderHook(() => useImportLeads(), { wrapper: createWrapper() });
    expect(typeof result.current.importLeadsToCustomPipeline).toBe("function");
  });

  it("exposes resetImport function", () => {
    const { result } = renderHook(() => useImportLeads(), { wrapper: createWrapper() });
    expect(typeof result.current.resetImport).toBe("function");
  });

  it("exposes parseCSV function", () => {
    const { result } = renderHook(() => useImportLeads(), { wrapper: createWrapper() });
    expect(typeof result.current.parseCSV).toBe("function");
  });

  it("coleta valores de campo personalizado (custom:<nome>) sem vazar para a observação", async () => {
    mockParseFn.mockImplementation((_f: File, opts: any) => {
      opts.complete({
        data: [{ Nome: "João", Telefone: "11999999999", cnpj: "12345678000199" }],
        errors: [],
      });
    });
    const file = new File(["Nome,Telefone,cnpj\nJoão,11999999999,12345678000199"], "leads.csv");
    const { result } = renderHook(() => useImportLeads(), { wrapper: createWrapper() });
    const leads = await result.current.parseCSV(file, { cnpj: "custom:cnpj" });

    expect(leads).toHaveLength(1);
    // valor vai para customFields (edge grava em lead_custom_field_values)
    expect(leads[0].customFields).toEqual({ cnpj: "12345678000199" });
    // e NÃO vaza para "Outros campos" da observação
    expect(leads[0].notes ?? "").not.toContain("12345678000199");
    expect(leads[0].kommoBlock ?? "").not.toContain("12345678000199");
    // campos de sistema seguem normais
    expect(leads[0].name).toBe("João");
    expect(leads[0].phone).toBe("11999999999");
  });

  it("exposes importLeads function", () => {
    const { result } = renderHook(() => useImportLeads(), { wrapper: createWrapper() });
    expect(typeof result.current.importLeads).toBe("function");
  });

  it("exposes fixExistingLeadNames function", () => {
    const { result } = renderHook(() => useImportLeads(), { wrapper: createWrapper() });
    expect(typeof result.current.fixExistingLeadNames).toBe("function");
  });
});

// ─── Type exports ───

describe("Type exports", () => {
  it("FunnelDestination accepts valid values", () => {
    const destinations: FunnelDestination[] = ["qualificacao", "propostas", "confirmacao"];
    expect(destinations).toHaveLength(3);
  });

  it("FilePreviewResult shape", () => {
    const preview: FilePreviewResult = {
      columns: ["a"],
      sampleRows: [{ a: "1" }],
      suggestedMapping: { a: "name" },
      unmappedColumns: [],
      knownFields: ["name"],
      totalRows: 1,
    };
    expect(preview.columns).toBeDefined();
    expect(preview.totalRows).toBe(1);
  });

  it("EdgeFunctionReport shape", () => {
    const report: EdgeFunctionReport = {
      total: 10,
      created: 8,
      updated: 1,
      rejected: 1,
      errors: [{ row: 3, reason: "no name" }],
    };
    expect(report.total).toBe(10);
    expect(report.errors).toHaveLength(1);
  });
});
