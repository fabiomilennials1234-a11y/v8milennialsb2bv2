/**
 * Carteira — aba Pedidos: listar + editar pedido MANUAL.
 *
 * Escopo travado pelo CTO: "apenas listar os pedidos e poder editar aqueles sem
 * link com o ERP". Não existe cancelar nesta fatia.
 *
 * O que estes testes travam:
 *  · o CONTRATO com as RPCs (nomes e formato dos parâmetros). Um rename no
 *    banco sem rename aqui passaria pelo `as any` do supabase.rpc em silêncio —
 *    é o único ponto do sistema onde TS não protege, porque as RPCs novas ainda
 *    não estão em `integrations/supabase/types.ts` (regen sai de prod).
 *  · a INVALIDAÇÃO de cache. Editar mexe em upsell_clients via trigger
 *    síncrono; esquecer `portfolio-kpis`/`portfolio-clients` deixaria a carteira
 *    exibindo número velho.
 *  · a regra "itens mandam no total" e "sem itens, sale_value vale".
 *  · o mapa de erros: o usuário nunca pode ver o texto cru do Postgres, e a
 *    mensagem de bloqueio nunca pode mandar cancelar uma NF-e que não existe.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { useCarteiraOrders } from "@/modules/carteira/hooks/useCarteiraOrders";
import { useUpdateOrder } from "@/modules/carteira/hooks/useUpdateOrder";
import {
  orderErrorMessage,
  ORDER_ERROR_FALLBACK,
} from "@/modules/carteira/lib/order-errors";
import {
  erpSourceLabel,
  erpBlockMessage,
  sourceLabel,
} from "@/modules/carteira/lib/order-display";
import { editOrderSchema, sumItems } from "@/modules/carteira/lib/order-schema";
import {
  toDateInput,
  withDatePreservingTime,
} from "@/modules/carteira/lib/order-date";
import { toast } from "sonner";

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { wrapper, invalidateSpy };
}

function invalidatedKeys(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: [], error: null });
});

describe("useCarteiraOrders", () => {
  it("chama carteira_list_orders com paginação, busca e org", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCarteiraOrders({ search: "  acme  ", limit: 50, offset: 100 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rpcMock).toHaveBeenCalledWith("carteira_list_orders", {
      p_limit: 50,
      p_offset: 100,
      p_search: "acme",
      p_org_id: "org-1",
    });
  });

  it("não manda p_status — a RPC lista só aprovados", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCarteiraOrders(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock.mock.calls[0][1]).not.toHaveProperty("p_status");
  });

  it("manda p_search null quando a busca está vazia (não string vazia)", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCarteiraOrders({ search: "   " }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock.mock.calls[0][1].p_search).toBeNull();
  });

  it("separa o cache por página — trocar de página não reusa a lista errada", async () => {
    const { wrapper } = createWrapper();
    const { result: p1 } = renderHook(() => useCarteiraOrders({ offset: 0 }), {
      wrapper,
    });
    const { result: p2 } = renderHook(() => useCarteiraOrders({ offset: 50 }), {
      wrapper,
    });

    await waitFor(() => {
      expect(p1.current.isSuccess).toBe(true);
      expect(p2.current.isSuccess).toBe(true);
    });

    const offsets = rpcMock.mock.calls.map((c) => c[1].p_offset);
    expect(offsets).toContain(0);
    expect(offsets).toContain(50);
  });
});

describe("useUpdateOrder", () => {
  it("manda p_items null quando os itens não foram tocados", async () => {
    rpcMock.mockResolvedValue({ data: { id: "o1" }, error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateOrder(), { wrapper });

    result.current.mutate({ orderId: "o1", patch: { sale_value: 1500 } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("carteira_update_order", {
      p_order_id: "o1",
      p_patch: { sale_value: 1500 },
      p_items: null,
    });
  });

  it("envia cabeçalho e itens na MESMA chamada (uma transação)", async () => {
    rpcMock.mockResolvedValue({ data: { id: "o1" }, error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateOrder(), { wrapper });

    result.current.mutate({
      orderId: "o1",
      patch: { product_name: "Caixa" },
      items: [{ product_name: "Caixa", quantity: 2, unit_price: 50 }],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][1].p_items).toHaveLength(1);
  });

  it("invalida as métricas de dinheiro da carteira, não só a lista", async () => {
    rpcMock.mockResolvedValue({ data: { id: "o1" }, error: null });
    const { wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => useUpdateOrder(), { wrapper });

    result.current.mutate({ orderId: "o1", patch: { sale_value: 10 } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidatedKeys(invalidateSpy);
    expect(keys).toContain("carteira_orders");
    expect(keys).toContain("portfolio-kpis");
    expect(keys).toContain("portfolio-clients");
    expect(keys).toContain("upsell_orders");
    expect(keys).toContain("upsell_clients");
  });

  it("avisa que o pedido mudou de cliente quando client_id muda", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "o1", client_id: "c2", previous_client_id: "c1" },
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateOrder(), { wrapper });

    result.current.mutate({ orderId: "o1", patch: { client_id: "c2" } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(toast.success).toHaveBeenCalledWith(
      "Pedido movido",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  // ── Gate de procedência: o coração do escopo travado pelo CTO ─────────────
  it("pedido com vínculo ERP é recusado, e a mensagem fala de ERP", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'erro: order_erp_linked' },
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateOrder(), { wrapper });

    result.current.mutate({ orderId: "o1", patch: { sale_value: 10 } });
    await waitFor(() => expect(result.current.isError).toBe(true));

    const msg = (toast.error as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msg).toContain("ERP");
    // Nunca manda cancelar nota: 232 dos pedidos bloqueados em prod não têm NF.
    expect(msg).not.toMatch(/NF-e|nota fiscal/i);
  });

  it("pedido não-aprovado é recusado pela RPC (pending/rejected)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "ERRO: order_not_approved" },
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateOrder(), { wrapper });

    result.current.mutate({ orderId: "o-pending", patch: { sale_value: 10 } });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(toast.error).toHaveBeenCalledWith(
      "Só pedidos aprovados podem ser editados. Atualize a lista.",
    );
  });

  it("o toast de troca de cliente NÃO afirma nada sobre receita", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "o1", client_id: "c2", previous_client_id: "c1" },
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateOrder(), { wrapper });

    result.current.mutate({ orderId: "o1", patch: { client_id: "c2" } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [title, opts] = (toast.success as ReturnType<typeof vi.fn>).mock.calls[0];
    const text = `${title} ${(opts as { description?: string })?.description ?? ""}`;
    // Editar pedido aprovado não emite correção em sale_events. Afirmar
    // "a receita passou a contar no novo cliente" seria falso para org com
    // carteira_emits_revenue_enabled.
    expect(text).not.toMatch(/receita/i);
    expect(text).toMatch(/carteira/i);
  });

  it("corrida no cabeçalho vira mensagem acionável (order_state_changed)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "order_state_changed" },
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateOrder(), { wrapper });

    result.current.mutate({ orderId: "o1", patch: { sale_value: 10 } });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(toast.error).toHaveBeenCalledWith(
      "O pedido mudou enquanto você editava. Atualize a lista e refaça a alteração.",
    );
  });

  it("IDOR cross-tenant no update devolve erro de cliente inválido", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "invalid_client" },
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateOrder(), { wrapper });

    result.current.mutate({
      orderId: "o1",
      patch: { client_id: "cliente-de-outra-org" },
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(toast.error).toHaveBeenCalledWith(
      "Cliente inválido para esta organização.",
    );
  });

  it("traduz o erro da RPC em vez de vazar o texto do Postgres", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'duplicate key value violates unique constraint "x"',
      },
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateOrder(), { wrapper });

    result.current.mutate({ orderId: "o1", patch: { sale_value: 10 } });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(toast.error).toHaveBeenCalledWith(ORDER_ERROR_FALLBACK);
  });
});

describe("order-errors", () => {
  it("cai no fallback único quando o código é desconhecido", () => {
    expect(orderErrorMessage({ message: "boom qualquer" })).toBe(
      ORDER_ERROR_FALLBACK,
    );
  });

  it("nunca devolve 'Algo deu errado'", () => {
    expect(ORDER_ERROR_FALLBACK).not.toMatch(/algo deu errado/i);
  });

  it("reconhece access_denied dos asserts de tenancy", () => {
    expect(orderErrorMessage({ message: "access_denied" })).toBe(
      "Você não tem acesso a este pedido.",
    );
  });
});

describe("order-display", () => {
  it("rotula a procedência pelo sistema, não por 'Faturado'", () => {
    expect(erpSourceLabel("tiny")).toBe("TinyERP");
    expect(erpSourceLabel("omie")).toBe("Omie");
    expect(erpSourceLabel("nfe")).toBe("NF-e");
  });

  it("mensagem de bloqueio nomeia a origem e nunca cita permissão", () => {
    const tiny = erpBlockMessage("tiny");
    expect(tiny).toContain("TinyERP");
    expect(tiny).not.toMatch(/permiss|administrador/i);

    // Só o caso 'nfe' pode falar em NF-e — os outros não têm nota nenhuma.
    expect(erpBlockMessage("nfe")).toContain("NF-e");
    expect(erpBlockMessage("tiny")).not.toContain("NF-e");
    expect(erpBlockMessage("omie")).not.toContain("NF-e");
  });

  it("sourceLabel é o mesmo mapa que ClienteOrderHistory usava", () => {
    expect(sourceLabel("pipe")).toBe("Pipeline");
    expect(sourceLabel("csv_import")).toBe("CSV");
    expect(sourceLabel(null)).toBe("—");
  });
});

describe("order-date — sold_at não pode andar sozinho", () => {
  it("round-trip sem tocar na data é idempotente (não vira meio-dia)", () => {
    // Instante arbitrário com hora significativa.
    const iso = new Date(2026, 7, 1, 21, 37, 12).toISOString();
    const preserved = withDatePreservingTime(iso, toDateInput(iso));
    expect(preserved).toBe(iso);
  });

  it("preserva a hora original ao trocar só o dia", () => {
    const iso = new Date(2026, 7, 1, 21, 37, 12).toISOString();
    const moved = withDatePreservingTime(iso, "2026-08-05");
    const d = new Date(moved);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(5);
    // hora local intacta — é isto que impede a venda de trocar de dia UTC
    expect(d.getHours()).toBe(21);
    expect(d.getMinutes()).toBe(37);
    expect(d.getSeconds()).toBe(12);
  });

  it("pedido perto da meia-noite não muda de instante no round-trip", () => {
    // Os 29 de 302 pedidos em prod que caem na janela 00:00–03:00 UTC.
    const iso = "2026-08-01T01:30:00.000Z";
    expect(withDatePreservingTime(iso, toDateInput(iso))).toBe(iso);
  });
});

describe("order-schema — espelho dos CHECKs do banco", () => {
  const base = {
    client_id: "11111111-1111-1111-1111-111111111111",
    product_name: "Caixa",
    sold_at: "2026-08-13",
    sale_value: 100,
    closer_id: null,
    sale_responsible_id: null,
    items: [],
  };

  it("recusa sale_value <= 0 (upsell_orders_sale_value_check)", () => {
    expect(editOrderSchema.safeParse({ ...base, sale_value: 0 }).success).toBe(false);
    expect(editOrderSchema.safeParse({ ...base, sale_value: -1 }).success).toBe(false);
    expect(editOrderSchema.safeParse(base).success).toBe(true);
  });

  it("recusa descrição vazia e data vazia", () => {
    expect(editOrderSchema.safeParse({ ...base, product_name: "  " }).success).toBe(false);
    expect(editOrderSchema.safeParse({ ...base, sold_at: "" }).success).toBe(false);
  });

  it("recusa item com quantidade zero ou preço negativo", () => {
    const badQty = {
      ...base,
      items: [{ product_name: "X", quantity: 0, unit_price: 10, unit: "un" }],
    };
    const badPrice = {
      ...base,
      items: [{ product_name: "X", quantity: 1, unit_price: -5, unit: "un" }],
    };
    expect(editOrderSchema.safeParse(badQty).success).toBe(false);
    expect(editOrderSchema.safeParse(badPrice).success).toBe(false);
  });

  it("aceita itens válidos e soma como o banco soma", () => {
    const withItems = {
      ...base,
      items: [
        { product_name: "A", quantity: 3, unit_price: 100, unit: "cx" },
        { product_name: "B", quantity: 2, unit_price: 50, unit: "un" },
      ],
    };
    expect(editOrderSchema.safeParse(withItems).success).toBe(true);
    expect(sumItems(withItems.items)).toBe(400);
  });
});
