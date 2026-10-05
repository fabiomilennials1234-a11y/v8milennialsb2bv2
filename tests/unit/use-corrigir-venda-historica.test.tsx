import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const { rpc, eq, maybeSingle } = vi.hoisted(() => ({ rpc: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = { select: vi.fn(), eq, maybeSingle };
  chain.select.mockReturnValue(chain); eq.mockReturnValue(chain);
  return { supabase: { rpc, from: vi.fn(() => chain) } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
import { correcaoVendaError, useCorrigirVendaHistorica } from "@/modules/leads/components/deal-card/useCorrigirVendaHistorica";

beforeEach(() => { rpc.mockReset(); eq.mockClear(); maybeSingle.mockReset(); });
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidar = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(() => useCorrigirVendaHistorica("deal-1", "org-1"), { wrapper }), invalidar };
}
const correcao = { valor: 175, data: "2026-10-01", motivo: "Faturada em 01/10" };

describe("correção da venda histórica", () => {
  it("lê a versão do negócio na hora e envia tudo em uma única RPC", async () => {
    maybeSingle.mockResolvedValue({ data: { updated_at: "2026-09-30T19:21:00Z" }, error: null });
    rpc.mockResolvedValue({ error: null });
    const { result, invalidar } = setup();
    await result.current.mutateAsync(correcao);
    expect(eq).toHaveBeenCalledWith("id", "deal-1");
    expect(eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("corrigir_venda_historica", {
      p_deal_id: "deal-1", p_expected_updated_at: "2026-09-30T19:21:00Z",
      p_value: 175, p_date: "2026-10-01", p_reason: "Faturada em 01/10",
    });
    const keys = invalidar.mock.calls.map(([params]) => params?.queryKey?.[0]);
    expect(keys).toEqual(expect.arrayContaining(["leads-deals", "carteira_orders", "portfolio-kpis", "metric-measure", "dashboard-metrics"]));
  });
  it("propaga a recusa sem invalidar nada", async () => {
    maybeSingle.mockResolvedValue({ data: { updated_at: "x" }, error: null });
    rpc.mockResolvedValue({ error: { code: "PT409", message: "sale_state_changed" } });
    const { result, invalidar } = setup();
    await expect(result.current.mutateAsync(correcao)).rejects.toThrow("outra pessoa");
    expect(invalidar).not.toHaveBeenCalled();
  });
  it("não chama a RPC quando o negócio some", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const { result } = setup();
    await expect(result.current.mutateAsync(correcao)).rejects.toThrow("não encontrada");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("traduz os códigos do banco", () => {
    expect(correcaoVendaError({ code: "PGRST202" })).toContain("ainda não está disponível");
    expect(correcaoVendaError({ message: "invalid_sale_date" })).toContain("não seja futura");
    expect(correcaoVendaError({ message: "access_denied" })).toContain("permissão");
  });
});
