import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

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
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
  },
}));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-test" }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

import { parseFilePreview, useImportLeads, pickBestPhone, cleanEmail } from "@/modules/leads";

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ─── pickBestPhone ───────────────────────────────────────

describe("pickBestPhone", () => {
  it("returns undefined for empty / falsy", () => {
    expect(pickBestPhone("")).toBeUndefined();
    expect(pickBestPhone(null)).toBeUndefined();
    expect(pickBestPhone(undefined)).toBeUndefined();
  });

  it("extracts a single landline with trailing name", () => {
    // (15)3282-2223 (marcio) → ddd 15 + 8 dígitos
    expect(pickBestPhone("(15)3282-2223 (marcio)")).toBe("1532822223");
  });

  it("picks the mobile over the landline when cell has two numbers (/-separated)", () => {
    expect(pickBestPhone("(16)3234-1290 /(16)99778-0380 Bruno")).toBe("16997780380");
  });

  it("dedups identical doubled numbers", () => {
    expect(pickBestPhone("(11)94391-6340/(11)94391-6340")).toBe("11943916340");
  });

  it("picks the mobile from two valid numbers", () => {
    expect(pickBestPhone("(11)4039-7039/(11)99993-4833")).toBe("11999934833");
  });

  it("strips BR country code 55 to local digits", () => {
    expect(pickBestPhone("5511999998888")).toBe("11999998888");
  });

  it("handles Excel scientific notation (pt-BR comma)", () => {
    // 5,511999E+12 ≈ 5511999000000 → local 11999000000
    expect(pickBestPhone("5,511999E+12")).toBe("11999000000");
  });

  it("returns undefined for an unsalvageable landline without DDD (8 digits)", () => {
    expect(pickBestPhone("3538-1137")).toBeUndefined();
  });

  it("returns undefined when two numbers are jammed with no separator (22 digits)", () => {
    expect(pickBestPhone("1194391634011943916340")).toBeUndefined();
  });
});

// ─── cleanEmail ──────────────────────────────────────────

describe("cleanEmail", () => {
  it("returns undefined when no @ present", () => {
    expect(cleanEmail("CNPJ:54824863000102")).toBeUndefined();
    expect(cleanEmail("")).toBeUndefined();
  });

  it("strips a leading label prefix", () => {
    expect(cleanEmail("Email:boulderparticipacoes@gmail.com")).toBe("boulderparticipacoes@gmail.com");
  });

  it("lowercases and trims", () => {
    expect(cleanEmail("  NF@ALOP.COM.BR ")).toBe("nf@alop.com.br");
  });

  it("picks first address from a separated list", () => {
    expect(cleanEmail("a@b.com; c@d.com")).toBe("a@b.com");
  });
});

// ─── End-to-end parse (regression for Cauta import) ──────

const ROWS = [
  {
    "Nome": "A C Pasquotto & cia ltda", "Empresa": "A C Pasquotto & cia ltda",
    "Email": "marcio@marpa-alimentos.com.br", "Telefone": "(15)3282-2223 (marcio)",
    "Segmento": "alimentício", "Notas": "Última compra: 25/09/2023",
    "Produto": "ketchup marpa 400g", "Observações etapa": "sem pedido em aberto | ATIVO",
  },
  {
    "Nome": "Agribiol", "Empresa": "Agribiol- biológicos agricolas ltda",
    "Email": "abertura.analise@gmail.com", "Telefone": "(16)3234-1290 /(16)99778-0380 Bruno",
    "Segmento": "industrias", "Notas": "Última compra: 19/08/2025",
    "Produto": "rizobiol", "Observações etapa": "sem pedido em aberto | ATIVO",
  },
  {
    "Nome": "Alop Aromas", "Empresa": "ALOP INDÚSTRIA E COMÉRCIO LTDA",
    "Email": "nf@alop.com.br", "Telefone": "(11)94391-6340/(11)94391-6340",
    "Segmento": "cosméticos", "Notas": "Última compra: 15/05/2026",
    "Produto": "Aromatizante 250ml", "Observações etapa": "pedido em aberto | ATIVO",
  },
];

describe("Cauta import — phone/email reach dedicated fields", () => {
  it("maps all headers and parses a clean single phone + email per lead", async () => {
    mockParseFn.mockImplementation((_f: File, opts: any) => opts.complete({ data: ROWS, errors: [] }));
    const file = new File(["x"], "cauta.csv", { type: "text/csv" });

    const preview = await parseFilePreview(file);
    expect(preview.unmappedColumns).toEqual([]);
    expect(preview.suggestedMapping["Telefone"]).toBe("phone");
    expect(preview.suggestedMapping["Email"]).toBe("email");

    const { result } = renderHook(() => useImportLeads(), { wrapper: createWrapper() });
    const leads = await result.current.parseCSV(file, preview.suggestedMapping);

    expect(leads).toHaveLength(3);
    expect(leads[0]).toMatchObject({ phone: "1532822223", email: "marcio@marpa-alimentos.com.br" });
    expect(leads[1]).toMatchObject({ phone: "16997780380", email: "abertura.analise@gmail.com" });
    expect(leads[2]).toMatchObject({ phone: "11943916340", email: "nf@alop.com.br" });

    // phone/email never leak into the observação (notes)
    for (const l of leads) {
      expect(l.notes ?? "").not.toContain("@");
      expect(l.notes ?? "").not.toMatch(/\d{8,}/);
      expect(l.kommoBlock ?? "").toBe("");
    }
  });
});
