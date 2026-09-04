/**
 * Importar leads SEM funil (tela de Leads).
 *
 * A regra que este arquivo prende é uma frase do CTO: "essa importação sem
 * criação de negócios". No motor da edge, `destination` é o que decide se a
 * linha vira só uma pessoa ou uma pessoa MAIS um card em `pipeline_entries` —
 * então o corpo que sai daqui é onde essa decisão vive do lado do cliente. Um
 * `stage`/`pipeline_id` vazando neste payload cria negócio que ninguém pediu.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

/** O que o Papa.parse entrega ao `complete` — só o que este teste usa. */
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

const RELATORIO_OK = {
  success: true,
  report: { total: 2, created: 2, updated: 0, rejected: 0, incomplete: 0, errors: [] },
};

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

/** Duas linhas de planilha, entregues pelo parser de CSV. */
function planilhaComDuasLinhas() {
  mockParse.mockImplementation((_file: unknown, opts: ParseOpts) => {
    opts.complete({
      data: [
        { Nome: "Ana Souza", Telefone: "(11) 98888-7777", Empresa: "Acme", Etapa: "Proposta enviada" },
        { Nome: "Bruno Lima", Email: "bruno@acme.com", Etapa: "Novo" },
      ],
    });
  });
  return new File(["nome,telefone\n"], "leads.csv", { type: "text/csv" });
}

const fetchMock = vi.fn();

beforeEach(() => {
  mockParse.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => RELATORIO_OK });
  vi.stubGlobal("fetch", fetchMock);
});

describe("importLeadsOnly — o corpo que sai", () => {
  it("manda destination 'leads' e NENHUMA chave de funil", async () => {
    const file = planilhaComDuasLinhas();
    const { result } = renderHook(() => useImportLeads(), { wrapper: wrapper() });

    await result.current.importLeadsOnly(file, { members: [{ id: "m1", name: "Carol" }] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const corpo = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(corpo.destination).toBe("leads");
    expect(corpo.organization_id).toBe("org-teste");
    // As chaves que fariam a edge escrever em pipeline_entries.
    for (const chave of [
      "pipeline_id",
      "pipeline_stage",
      "stage_key",
      "stage_id",
      "funnel_destination",
      "custom_pipeline_id",
      "custom_stage_id",
      "campanha_id",
    ]) {
      expect(corpo[chave]).toBeUndefined();
    }
  });

  it("leva o responsável padrão e o período de métricas escolhidos", async () => {
    const file = planilhaComDuasLinhas();
    const { result } = renderHook(() => useImportLeads(), { wrapper: wrapper() });

    await result.current.importLeadsOnly(file, {
      responsibleId: "membro-7",
      metricsPeriodMonth: 3,
      metricsPeriodYear: 2026,
    });

    const corpo = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(corpo.responsible_id).toBe("membro-7");
    expect(corpo.sdr_id).toBe("membro-7");
    expect(corpo.metrics_period_month).toBe(3);
    expect(corpo.metrics_period_year).toBe(2026);
  });

  it("devolve o relatório traduzido para a UI", async () => {
    const file = planilhaComDuasLinhas();
    const { result } = renderHook(() => useImportLeads(), { wrapper: wrapper() });

    const relatorio = await result.current.importLeadsOnly(file);

    expect(relatorio).toMatchObject({ total: 2, imported: 2, updated: 0, duplicates: 0, invalid: 0 });
  });

  it("não chama a edge quando a planilha não rende nenhum lead", async () => {
    mockParse.mockImplementation((_f: unknown, opts: ParseOpts) => opts.complete({ data: [] }));
    const file = new File(["\n"], "vazia.csv", { type: "text/csv" });
    const { result } = renderHook(() => useImportLeads(), { wrapper: wrapper() });

    await expect(result.current.importLeadsOnly(file)).rejects.toThrow(/Nenhum lead/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
