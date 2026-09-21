import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRenomearNegocio } from "@/modules/leads/components/deal-card/useRenomearNegocio";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), sucesso: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: mocks }));
vi.mock("sonner", () => ({ toast: { success: mocks.sucesso } }));

function consulta(error: { message: string } | null = null) {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: error ? null : { id: "id" }, error }),
  };
}

function montar(opcoes: Partial<Parameters<typeof useRenomearNegocio>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidar = vi.spyOn(client, "invalidateQueries");
  const hook = renderHook(() => useRenomearNegocio({
    entryId: "entrada-1", dealId: "negocio-1", leadId: "lead-1", organizacaoId: "org-1", ...opcoes,
  }), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  return { ...hook, invalidar };
}

describe("renomear negócio — escrita independente do lead", () => {
  beforeEach(() => vi.resetAllMocks());

  it("por padrão grava somente o título do negócio da organização e do lead corretos", async () => {
    const negocio = consulta();
    mocks.from.mockReturnValue(negocio);
    const { result, invalidar } = montar();
    await act(() => result.current.mutateAsync({ nome: "  Pedido setembro  " }));
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith("deals");
    expect(negocio.update).toHaveBeenCalledWith({ title: "Pedido setembro" });
    expect(negocio.eq.mock.calls).toEqual([["id", "negocio-1"], ["lead_id", "lead-1"], ["organization_id", "org-1"]]);
    expect(negocio.single).toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ["leads-deals"] });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ["pipeline-page"] });
    expect(invalidar).not.toHaveBeenCalledWith({ queryKey: ["lead-detail", "lead-1"] });
  });

  it("grava o nome do lead apenas quando solicitado", async () => {
    const negocio = consulta();
    const lead = consulta();
    mocks.from.mockReturnValueOnce(negocio).mockReturnValueOnce(lead);
    const { result, invalidar } = montar();
    await act(() => result.current.mutateAsync({ nome: "Pedido setembro", alterarLead: true }));
    expect(mocks.from.mock.calls).toEqual([["deals"], ["leads"]]);
    expect(lead.update).toHaveBeenCalledWith({ name: "Pedido setembro" });
    expect(lead.eq.mock.calls).toEqual([["id", "lead-1"], ["organization_id", "org-1"]]);
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ["lead-detail", "lead-1"] });
    expect(mocks.sucesso).toHaveBeenCalledWith("Nomes do negócio e do lead atualizados.");
  });

  it("materializa o negócio na própria entrada quando o card ainda não tem identidade", async () => {
    mocks.rpc.mockResolvedValue({ data: "negocio-criado", error: null });
    const negocio = consulta();
    mocks.from.mockReturnValue(negocio);
    const { result } = montar({ dealId: null });
    await act(() => result.current.mutateAsync({ nome: "Pedido setembro", alterarLead: false }));
    expect(mocks.rpc).toHaveBeenCalledWith("garantir_negocio_da_entrada", { p_entry_id: "entrada-1" });
    expect(negocio.eq).toHaveBeenCalledWith("id", "negocio-criado");
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("não altera o lead nem indica sucesso quando o update do negócio é recusado", async () => {
    mocks.from.mockReturnValue(consulta({ message: "JSON object requested, multiple (or no) rows returned" }));
    const { result } = montar();
    await act(async () => {
      await expect(result.current.mutateAsync({ nome: "Pedido", alterarLead: true })).rejects.toThrow("Não foi possível salvar o nome do negócio");
    });
    expect(mocks.from.mock.calls).toEqual([["deals"]]);
    expect(mocks.sucesso).not.toHaveBeenCalled();
  });

  it("informa a falha parcial e atualiza o título salvo se o lead não puder ser alterado", async () => {
    mocks.from.mockReturnValueOnce(consulta()).mockReturnValueOnce(consulta({ message: "denied" }));
    const { result, invalidar } = montar();
    await act(async () => {
      await expect(result.current.mutateAsync({ nome: "Pedido", alterarLead: true })).rejects.toThrow("O nome do negócio foi salvo, mas o nome do lead não foi alterado");
    });
    expect(mocks.sucesso).not.toHaveBeenCalled();
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ["leads-deals"] });
  });

  it("interrompe a operação quando a materialização falha", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    const { result } = montar({ dealId: null });
    await act(async () => {
      await expect(result.current.mutateAsync({ nome: "Pedido", alterarLead: true })).rejects.toThrow("Não foi possível preparar o negócio");
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each([
    { nome: "   ", opcoes: {} },
    { nome: "Pedido", opcoes: { organizacaoId: null } },
    { nome: "Pedido", opcoes: { leadId: null } },
    { nome: "Pedido", opcoes: { entryId: null } },
  ])("recusa nome vazio ou contexto incompleto: %j", async ({ nome, opcoes }) => {
    const { result } = montar(opcoes);
    await act(async () => { await expect(result.current.mutateAsync({ nome })).rejects.toThrow(); });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
