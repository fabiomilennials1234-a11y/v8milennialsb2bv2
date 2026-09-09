/**
 * Tests for _shared/erp/sync/upsert-order.ts — canonical order upsert (módulo E):
 * client resolution, ERP source + approved status, idempotency.
 */
import { describe, it, expect } from "vitest";
import {
  upsertCanonicalOrder,
  approvalForErpStatus,
  type OrderStore,
} from "../../supabase/functions/_shared/erp/sync/upsert-order";
import type { CanonicalOrder } from "../../supabase/functions/_shared/erp/types";

const ORDER: CanonicalOrder = {
  externalId: "555",
  externalRef: "pref",
  clientExternalId: "12345",
  saleValue: 1234.56,
  productName: "Parafuso M8",
  soldAt: null,
  etapa: "50",
};

function makeStore(overrides: Partial<OrderStore> = {}) {
  const calls = {
    updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    creates: [] as Array<Record<string, unknown>>,
  };
  const store: OrderStore = {
    findClientIdByExternalId: async () => "client-1", // default: client already synced
    findOrderByExternalId: async () => null,
    updateOrder: async (id, patch) => {
      calls.updates.push({ id, patch });
    },
    createOrder: async (row) => {
      calls.creates.push(row);
      return "order-new";
    },
    ...overrides,
  };
  return { store, calls };
}

describe("upsertCanonicalOrder", () => {
  it("skips when the order's client is not synced yet", async () => {
    const { store, calls } = makeStore({ findClientIdByExternalId: async () => null });
    const r = await upsertCanonicalOrder(store, {
      organizationId: "org1",
      source: "omie",
      order: ORDER,
    });
    expect(r).toEqual({ action: "skipped", reason: "client_not_synced" });
    expect(calls.creates).toHaveLength(0);
  });

  it("skips a zero/negative value order (would violate the sale_value check)", async () => {
    const { store, calls } = makeStore();
    const r = await upsertCanonicalOrder(store, {
      organizationId: "org1",
      source: "omie",
      order: { ...ORDER, saleValue: 0 },
    });
    expect(r).toEqual({ action: "skipped", reason: "zero_value" });
    expect(calls.creates).toHaveLength(0);
  });

  it("creates an ERP order that counts in metrics (source=erp, approved)", async () => {
    const { store, calls } = makeStore();
    const r = await upsertCanonicalOrder(store, {
      organizationId: "org1",
      source: "omie",
      order: ORDER,
    });
    expect(r).toEqual({ action: "created", orderId: "order-new" });
    const row = calls.creates[0];
    expect(row.client_id).toBe("client-1");
    expect(row.source).toBe("erp");
    expect(row.approval_status).toBe("approved");
    expect(row.product_type).toBe("unitario");
    expect(row.sale_value).toBe(1234.56);
    expect(row.product_name).toBe("Parafuso M8");
    expect(row.external_source).toBe("omie");
    expect(row.external_id).toBe("555");
    expect(row.organization_id).toBe("org1");
  });

  it("updates an existing order instead of duplicating (idempotent)", async () => {
    const { store, calls } = makeStore({ findOrderByExternalId: async () => ({ id: "o9" }) });
    const r = await upsertCanonicalOrder(store, {
      organizationId: "org1",
      source: "omie",
      order: ORDER,
    });
    expect(r).toEqual({ action: "updated", orderId: "o9" });
    expect(calls.creates).toHaveLength(0);
    expect(calls.updates[0].patch.external_id).toBe("555");
    expect(calls.updates[0].patch.sale_value).toBe(1234.56);
  });
});

/**
 * Vocabulário completo de `StatusPedido`, entregue pelo fornecedor em 01/09 a
 * partir do fonte do Toth. Até então o código conhecia dois valores — os que
 * apareceram numa amostra de dez pedidos.
 */
describe("approvalForErpStatus — as três situações da Carteira", () => {
  it("fatura consumada entra aprovada", () => {
    expect(approvalForErpStatus("FATURADO")).toBe("approved");
    expect(approvalForErpStatus("APROVADO")).toBe("approved");
    expect(approvalForErpStatus("  faturado  ")).toBe("approved");
  });

  it("cancelado e devolvido ficam ENCERRADOS, fora de toda métrica", () => {
    expect(approvalForErpStatus("CANCELADO")).toBe("rejected");
    expect(approvalForErpStatus("DEVOLVIDO")).toBe("rejected");
    expect(approvalForErpStatus("cancelado")).toBe("rejected");
  });

  it("o resto do enum é carteira em formação, não receita", () => {
    for (const s of ["NORMAL", "BLOQUEADO", "BAIXADO", "PENDENTE_ANALISE", "DEVOLVIDO_PARCIAL"]) {
      expect(approvalForErpStatus(s)).toBe("pending");
    }
  });

  /**
   * O CTO decidiu que parcial entraria proporcional. A API não permite: o item
   * traz `qtdpedido` e `valorunitario`, e nenhum campo de quantidade faturada.
   * Sem esse dado a proporção seria inventada — este teste trava a decisão até
   * o fornecedor expor `qtdFaturada`/`valorFaturado`.
   */
  it("FATURADO_PARCIAL fica pendente enquanto a API não disser quanto faturou", () => {
    expect(approvalForErpStatus("FATURADO_PARCIAL")).toBe("pending");
    expect(approvalForErpStatus("FATURADO_COMPATIBILIDADE")).toBe("pending");
  });

  it("provider sem situação (Omie) segue aprovado", () => {
    expect(approvalForErpStatus(null)).toBe("approved");
    expect(approvalForErpStatus(undefined)).toBe("approved");
    expect(approvalForErpStatus("")).toBe("approved");
  });
});
