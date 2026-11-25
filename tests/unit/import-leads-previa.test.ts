/**
 * Prévia da importação (flag `importacao_previa`) — o corpo que sai para a edge.
 *
 * A prévia não pode gravar: ela vai com `mode: "preview"` e sem decisões. A importação
 * depois da revisão leva as decisões por linha, e cada linha leva `source_row` — é por
 * esse número que a edge casa a decisão com a linha que ela mesma reclassifica.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

type ParseOpts = { complete: (r: { data: Record<string, string>[] }) => void };

const mockParse = vi.fn();
vi.mock("papaparse", () => ({
  default: { parse: (...args: unknown[]) => mockParse(...args) },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "jwt-de-teste" } } }) },
  },
}));

vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-teste" }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useImportLeads } from "@/modules/leads";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

/** Planilha com uma linha em branco no meio: a linha do Excel não é a posição. */
function planilha() {
  mockParse.mockImplementation((_file: unknown, opts: ParseOpts) => {
    opts.complete({
      data: [
        { Empresa: "Karmel Café", Telefone: "(51) 98134-0007" },
        { Empresa: "", Telefone: "" },
        { Empresa: "Cafeteria É de Chocolate", Telefone: "(51) 98134-0007" },
      ],
    });
  });
  return new File(["empresa,telefone\n"], "rs.csv", { type: "text/csv" });
}

const PREVIA = {
  success: true,
  preview: {
    rows: [
      { row: 2, group: "novo", name: "Karmel Café", phone: "5551981340007" },
      {
        row: 4,
        group: "outra_empresa",
        name: "Cafeteria É de Chocolate",
        phone: "5551981340007",
        match: { origem: "arquivo", row: 2, label: "Karmel Café", visible: true },
      },
    ],
    counts: { novo: 1, cliente_erp: 0, ja_lead: 0, repetido: 0, outra_empresa: 1, sem_telefone: 0, invalido: 0 },
  },
};

const fetchMock = vi.fn();

beforeEach(() => {
  mockParse.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("previewLeadsOnly", () => {
  it("pede só a prévia: mode 'preview', destino sem funil, linhas com a linha do Excel", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => PREVIA });
    const { result } = renderHook(() => useImportLeads(), { wrapper: wrapper() });

    const preview = await result.current.previewLeadsOnly(planilha());

    const corpo = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(corpo.mode).toBe("preview");
    expect(corpo.destination).toBe("leads");
    expect(corpo.decisions).toBeUndefined();
    expect(corpo.leads.map((l: { source_row?: number }) => l.source_row)).toEqual([2, 4]);
    expect(preview.rows).toHaveLength(2);
    expect(preview.counts.outra_empresa).toBe(1);
  });

  it("resposta sem prévia vira erro, nunca importação", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, report: {} }) });
    const { result } = renderHook(() => useImportLeads(), { wrapper: wrapper() });
    await expect(result.current.previewLeadsOnly(planilha())).rejects.toThrow(/prévia/);
  });

  it("flag desligada no servidor (403) chega como erro legível", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ success: false, error: "A prévia da importação não está ligada para esta organização." }),
    });
    const { result } = renderHook(() => useImportLeads(), { wrapper: wrapper() });
    await expect(result.current.previewLeadsOnly(planilha())).rejects.toThrow(/não está ligada/);
  });
});

describe("importLeadsOnly depois da revisão", () => {
  it("leva as decisões por linha; sem revisão, não leva nada", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        report: { total: 2, created: 2, updated: 0, rejected: 0, incomplete: 0, skipped: 0, errors: [] },
      }),
    });
    const { result } = renderHook(() => useImportLeads(), { wrapper: wrapper() });

    await result.current.importLeadsOnly(planilha(), {
      decisions: [
        { row: 2, action: "criar" },
        { row: 4, action: "criar_compartilhado" },
      ],
    });
    const comRevisao = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(comRevisao.decisions).toEqual([
      { row: 2, action: "criar" },
      { row: 4, action: "criar_compartilhado" },
    ]);
    expect(comRevisao.mode).toBeUndefined();

    await result.current.importLeadsOnly(planilha());
    const semRevisao = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(semRevisao.decisions).toBeUndefined();
  });
});

describe("etiqueta por coluna", () => {
  it("cada linha leva a etiqueta do seu segmento; segmento sem etiqueta não leva nada", async () => {
    mockParse.mockImplementation((_file: unknown, opts: ParseOpts) => {
      opts.complete({
        data: [
          { Empresa: "Le Bari Café", Telefone: "(54) 99931-6404", Segmento: "Cafeteria" },
          { Empresa: "Hotel Pampas", Telefone: "(54) 3282-3433", Segmento: "Hotel e Pousada" },
          { Empresa: "Livraria Empório Canela", Telefone: "(54) 3699-1121", Segmento: "Livraria" },
        ],
      });
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, report: { total: 3, created: 3, updated: 0, rejected: 0, errors: [] } }),
    });
    const { result } = renderHook(() => useImportLeads(), { wrapper: wrapper() });

    await result.current.importLeadsOnly(new File(["x"], "rs.csv", { type: "text/csv" }), {
      rowTagRule: { column: "Segmento", byValue: { cafeteria: "t-cafe", "hotel e pousada": "t-hotel" } },
    });

    const corpo = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(corpo.leads.map((l: { row_tag_ids?: string[] }) => l.row_tag_ids ?? null)).toEqual([
      ["t-cafe"],
      ["t-hotel"],
      null,
    ]);
    // As etiquetas "para todos" continuam separadas.
    expect(corpo.tag_ids).toBeUndefined();
  });
});
