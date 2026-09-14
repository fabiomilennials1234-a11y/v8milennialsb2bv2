import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const { rpc, eq, limit } = vi.hoisted(() => ({ rpc: vi.fn(), eq: vi.fn(), limit: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = { select: vi.fn(), eq, order: vi.fn(), limit };
  chain.select.mockReturnValue(chain); eq.mockReturnValue(chain); chain.order.mockReturnValue(chain);
  return { supabase: { rpc, from: vi.fn(() => chain) } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
import { ajustePedidoError, useAjustarPedidoGanho } from "@/modules/leads/components/deal-card/useAjustarPedidoGanho";

beforeEach(() => { rpc.mockReset(); eq.mockClear(); limit.mockResolvedValue({data:[],error:null}); });
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry:false }, mutations: {retry:false} } });
  const invalidar = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({children}: {children:React.ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useAjustarPedidoGanho("deal-1", "entry-1", "2026-09-01T12:00:00Z", "org-1"), {wrapper});
  return {...hook, invalidar};
}

describe("gravação do ajuste", () => {
  it("envia versão, motivo, valor e itens em uma única RPC", async () => {
    rpc.mockResolvedValue({error:null});
    const {result, invalidar} = setup();
    const itens = [{id:"item-1",quantity:3,unit_price:50,discount_percent:0}];
    await result.current.mutateAsync({valor:150,motivo:"Mais café",itens});
    expect(rpc).toHaveBeenCalledExactlyOnceWith("ajustar_pedido_ganho", {
      p_deal_id:"deal-1", p_expected_updated_at:"2026-09-01T12:00:00Z",p_value:150,p_items:itens,p_reason:"Mais café",
    });
    const keys = invalidar.mock.calls.map(([params])=>params?.queryKey?.[0]);
    expect(keys).toEqual(expect.arrayContaining(["deal-card-extras","leads-deals","deal-order-adjustments","carteira_orders","portfolio-kpis","metric-measure","dashboard-metrics"]));
  });
  it("filtra o histórico pela organização e pelo negócio", async () => {
    setup();
    await waitFor(()=>expect(limit).toHaveBeenCalled());
    expect(eq).toHaveBeenCalledWith("deal_id","deal-1");
    expect(eq).toHaveBeenCalledWith("organization_id","org-1");
  });
  it("propaga recusa sem anunciar sucesso ou invalidar os valores", async () => {
    rpc.mockResolvedValue({error:{code:"40001",message:"order_state_changed"}});
    const {result,invalidar} = setup();
    await expect(result.current.mutateAsync({valor:150,motivo:"Ajuste",itens:null})).rejects.toThrow("outra pessoa");
    expect(invalidar).not.toHaveBeenCalled();
  });
  it("explica a migração pendente e o vínculo com ERP",()=> {
    expect(ajustePedidoError({code:"PGRST202"})).toContain("ainda não está disponível");
    expect(ajustePedidoError({message:"order_erp_linked"})).toContain("sistema de origem");
  });
});
