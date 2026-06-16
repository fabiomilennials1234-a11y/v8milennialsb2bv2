import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";
import { createMockSupabase } from "../helpers/supabase-mock";

// One shared mock instance per test (reset in beforeEach).
let mock = createMockSupabase();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => mock.sb.from(table),
  },
}));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-test", isReady: true }),
}));

import { useNewOrder } from "@/modules/carteira/hooks/useNewOrder";

const CLIENT_ID = "client-1";

beforeEach(() => {
  mock = createMockSupabase();
  vi.clearAllMocks();
});

describe("useNewOrder — manual_total mode", () => {
  it("uses the description as product_name when provided", async () => {
    const { result } = renderHook(() => useNewOrder(), { wrapper: createWrapper() });

    const res = await result.current.mutateAsync({
      clientId: CLIENT_ID,
      source: "manual",
      mode: "manual_total",
      saleValue: 1500,
      description: "  Pedido fechado por telefone  ",
    });

    expect(res.productName).toBe("Pedido fechado por telefone");
    expect(res.totalValue).toBe(1500);

    const orders = mock.getInserted("upsell_orders");
    expect(orders).toHaveLength(1);
    expect(orders[0].product_name).toBe("Pedido fechado por telefone");
    expect(orders[0].sale_value).toBe(1500);
    expect(orders[0].product_type).toBe("unitario");
  });

  it('falls back to "Venda avulsa" when no description', async () => {
    const { result } = renderHook(() => useNewOrder(), { wrapper: createWrapper() });

    const res = await result.current.mutateAsync({
      clientId: CLIENT_ID,
      source: "manual",
      mode: "manual_total",
      saleValue: 99.9,
    });

    expect(res.productName).toBe("Venda avulsa");
    expect(mock.getInserted("upsell_orders")[0].product_name).toBe("Venda avulsa");
  });

  it("throws when saleValue <= 0", async () => {
    const { result } = renderHook(() => useNewOrder(), { wrapper: createWrapper() });

    await expect(
      result.current.mutateAsync({
        clientId: CLIENT_ID,
        source: "manual",
        mode: "manual_total",
        saleValue: 0,
      }),
    ).rejects.toThrow(/maior que zero/);

    expect(mock.getInserted("upsell_orders")).toHaveLength(0);
  });

  it("does NOT insert client_purchase_items nor upsell_client_products", async () => {
    const { result } = renderHook(() => useNewOrder(), { wrapper: createWrapper() });

    await result.current.mutateAsync({
      clientId: CLIENT_ID,
      source: "manual",
      mode: "manual_total",
      saleValue: 200,
      description: "Avulso",
    });

    expect(mock.getInserted("upsell_orders")).toHaveLength(1);
    expect(mock.getInserted("client_purchase_items")).toHaveLength(0);
    expect(mock.getInserted("upsell_client_products")).toHaveLength(0);
  });
});

describe("useNewOrder — items mode (regression)", () => {
  it("inserts upsell_orders + client_purchase_items + upsell_client_products", async () => {
    const { result } = renderHook(() => useNewOrder(), { wrapper: createWrapper() });

    const res = await result.current.mutateAsync({
      clientId: CLIENT_ID,
      source: "manual",
      items: [
        { product_id: "p1", product_name: "Chapa", quantity: 2, unit_price: 100, unit: "un" },
        { product_id: "p2", product_name: "Solda", quantity: 1, unit_price: 50, unit: "kg" },
      ],
    });

    expect(res.totalValue).toBe(250);
    expect(res.productName).toBe("Chapa, Solda");

    expect(mock.getInserted("upsell_orders")).toHaveLength(1);
    expect(mock.getInserted("client_purchase_items")).toHaveLength(2);
    expect(mock.getInserted("upsell_client_products")).toHaveLength(2);
  });

  it("dedups distinct products for upsell_client_products", async () => {
    const { result } = renderHook(() => useNewOrder(), { wrapper: createWrapper() });

    await result.current.mutateAsync({
      clientId: CLIENT_ID,
      source: "manual",
      mode: "items",
      items: [
        { product_id: "p1", product_name: "Chapa", quantity: 1, unit_price: 100, unit: "un" },
        { product_id: "p1", product_name: "Chapa", quantity: 3, unit_price: 100, unit: "un" },
      ],
    });

    expect(mock.getInserted("client_purchase_items")).toHaveLength(2);
    expect(mock.getInserted("upsell_client_products")).toHaveLength(1);
  });
});
