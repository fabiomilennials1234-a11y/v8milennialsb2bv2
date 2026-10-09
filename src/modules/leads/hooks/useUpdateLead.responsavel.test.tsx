import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

/**
 * B1 — trocar o responsável no painel do chat precisa atualizar a LINHA do
 * inbox, que lê `useLeadResponsibleMap` (chave `["lead-responsible-map", …]`,
 * staleTime 60 s). Sem invalidar, o banco grava e a lista mostra o antigo.
 */

const chain = {
  update: () => chain,
  eq: () => chain,
  select: () => chain,
  single: () => Promise.resolve({ data: { id: "lead-1" }, error: null }),
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => chain, rpc: () => Promise.resolve({ data: 2, error: null }) },
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
  useCanDo: () => ({ allowed: true, isLoading: false }),
  useIdentity: () => ({ isAdmin: true, isMaster: false }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./useLeadsRealtime", () => ({ useLeadsRealtime: vi.fn() }));
vi.mock("./useLeadPhones", () => ({ buscarLeadIdsPorTelefoneSecundario: vi.fn() }));

import { patchTocaResponsavel, useUpdateLead } from "./useLeads";
import { useBulkAssign } from "./useBulkActions";

let qc: QueryClient;
let invalidate: MockInstance<QueryClient["invalidateQueries"]>;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidate = vi.spyOn(qc, "invalidateQueries");
});

function invalidouMapa() {
  return invalidate.mock.calls.some(
    ([filtro]) => (filtro as { queryKey?: unknown[] })?.queryKey?.[0] === "lead-responsible-map",
  );
}

describe("patchTocaResponsavel", () => {
  it("os três campos de dono contam; outros não", () => {
    expect(patchTocaResponsavel({ sale_responsible_id: "tm" })).toBe(true);
    expect(patchTocaResponsavel({ pre_sale_responsible_id: null })).toBe(true);
    expect(patchTocaResponsavel({ responsible_id: "tm" })).toBe(true);
    expect(patchTocaResponsavel({ name: "Ana" })).toBe(false);
  });
});

describe("useUpdateLead → mapa de responsáveis do inbox", () => {
  it.each(["sale_responsible_id", "pre_sale_responsible_id", "responsible_id"])(
    "patch com %s invalida lead-responsible-map",
    async (campo) => {
      const { result } = renderHook(() => useUpdateLead(), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({ id: "lead-1", [campo]: "tm-2" });
      });
      expect(invalidouMapa()).toBe(true);
    },
  );

  it("patch sem campo de dono NÃO paga o refetch do mapa", async () => {
    const { result } = renderHook(() => useUpdateLead(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "lead-1", name: "Ana" });
    });
    expect(invalidate).toHaveBeenCalled();
    expect(invalidouMapa()).toBe(false);
  });
});

describe("useBulkAssign → mapa de responsáveis do inbox", () => {
  it("atribuição em massa invalida lead-responsible-map", async () => {
    const { result } = renderHook(() => useBulkAssign(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ lead_ids: ["l1", "l2"], responsible_id: "tm-2", sdr_id: "tm-2", closer_id: null });
    });
    expect(invalidouMapa()).toBe(true);
  });
});
