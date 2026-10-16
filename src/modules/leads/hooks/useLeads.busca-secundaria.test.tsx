import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Perf onda 1 (F2) — a tela de Leads monta `useLeads` + contagens com o MESMO
 * termo, e cada queryFn resolvia o telefone secundário por conta própria: seis
 * `lead_phones ilike '%x%'` idênticos por termo (1 s cada em prod, 16/10).
 * Agora a pré-consulta passa pelo cache do TanStack, chaveada por (org, dígitos).
 */

const m = vi.hoisted(() => ({
  tabelas: [] as string[],
  ilikes: [] as string[],
  falhar: false,
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (tabela: string) => {
    const q: Record<string, unknown> = {};
    const encadeia = () => q;
    for (const k of ["select", "eq", "is", "or", "in", "order", "range", "limit", "returns", "gte", "lte", "not"]) {
      q[k] = encadeia;
    }
    q.ilike = (_col: string, padrao: string) => {
      m.ilikes.push(padrao);
      return q;
    };
    q.then = (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      if (tabela === "lead_phones" && m.falhar) {
        return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve, reject);
      }
      const data = tabela === "lead_phones" ? [{ lead_id: "11111111-1111-4111-8111-111111111111" }] : [];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    };
    return q;
  };
  return {
    supabase: {
      rpc: () => Promise.resolve({ data: null, error: null }),
      from: (tabela: string) => {
        m.tabelas.push(tabela);
        return builder(tabela);
      },
    },
  };
});
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
  useCanDo: () => ({ allowed: true, isLoading: false }),
  useIdentity: () => ({ isAdmin: true, isMaster: false }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./useLeadsRealtime", () => ({ useLeadsRealtime: vi.fn() }));

import { useLeads, useLeadsCount } from "./useLeads";
import { buscarLeadIdsPorTelefoneSecundario, useSalvarTelefonesDoLead } from "./useLeadPhones";

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);
const consultasDeTelefone = () => m.tabelas.filter((t) => t === "lead_phones").length;

beforeEach(() => {
  m.tabelas = [];
  m.ilikes = [];
  m.falhar = false;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

/** O que `Leads.tsx` monta: a lista e as contagens (total + abas). */
function useTelaDeLeads(searchQuery: string) {
  const lista = useLeads({ searchQuery });
  const total = useLeadsCount({ searchQuery });
  const todas = useLeadsCount({ searchQuery, filterClassificacao: "all" });
  const lead = useLeadsCount({ searchQuery, filterClassificacao: "lead" });
  const cliente = useLeadsCount({ searchQuery, filterClassificacao: "cliente" });
  const perdido = useLeadsCount({ searchQuery, filterClassificacao: "perdido" });
  return [lista, total, todas, lead, cliente, perdido];
}

describe("pré-consulta de telefone secundário", () => {
  it("seis hooks com o mesmo termo → UMA consulta a lead_phones", async () => {
    const { result } = renderHook(() => useTelaDeLeads("(17) 98125-7650"), { wrapper });
    await waitFor(() => expect(result.current.every((q) => q.isSuccess)).toBe(true));
    expect(consultasDeTelefone()).toBe(1);
    expect(m.ilikes).toEqual(["%17981257650%"]);
  });

  it("o mesmo número com outra máscara reusa o cache (chave pelos dígitos)", async () => {
    const primeira = renderHook(() => useTelaDeLeads("17981257650"), { wrapper });
    await waitFor(() => expect(primeira.result.current.every((q) => q.isSuccess)).toBe(true));
    const segunda = renderHook(() => useTelaDeLeads("17 98125 7650"), { wrapper });
    await waitFor(() => expect(segunda.result.current.every((q) => q.isSuccess)).toBe(true));
    expect(consultasDeTelefone()).toBe(1);
  });

  it("termo que não é telefone não consulta lead_phones", async () => {
    const { result } = renderHook(() => useTelaDeLeads("Maria"), { wrapper });
    await waitFor(() => expect(result.current.every((q) => q.isSuccess)).toBe(true));
    expect(consultasDeTelefone()).toBe(0);
  });

  it("org diferente é outra consulta (cache nunca cruza inquilino)", async () => {
    await buscarLeadIdsPorTelefoneSecundario(qc, "org-1", "17981257650");
    await buscarLeadIdsPorTelefoneSecundario(qc, "org-2", "17981257650");
    expect(consultasDeTelefone()).toBe(2);
  });

  it("falha degrada para [] e não fica em cache: a próxima chamada tenta de novo", async () => {
    m.falhar = true;
    expect(await buscarLeadIdsPorTelefoneSecundario(qc, "org-1", "17981257650")).toEqual([]);
    m.falhar = false;
    expect(await buscarLeadIdsPorTelefoneSecundario(qc, "org-1", "17981257650")).toEqual([
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(consultasDeTelefone()).toBe(2);
  });

  it("salvar telefones derruba o cache: a próxima busca vai ao banco", async () => {
    await buscarLeadIdsPorTelefoneSecundario(qc, "org-1", "17981257650");
    await buscarLeadIdsPorTelefoneSecundario(qc, "org-1", "17981257650");
    expect(consultasDeTelefone()).toBe(1);

    const { result } = renderHook(() => useSalvarTelefonesDoLead("lead-1"), { wrapper });
    await act(() => result.current.mutateAsync([{ phone: "17981257650", label: null, isPrimary: true }]));

    await buscarLeadIdsPorTelefoneSecundario(qc, "org-1", "17981257650");
    expect(consultasDeTelefone()).toBe(2);
  });
});
