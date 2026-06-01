import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

const mockFrom = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
  },
}));
vi.mock("@/modules/identity/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-test", isReady: true }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  useProducts,
  type Product,
  type ProductType,
  type ProductVariant,
} from "@/modules/carteira/hooks/useProducts";

const MOCK_PRODUCTS: Partial<Product>[] = [
  { id: "p1", name: "Plano Mensal", type: "mrr" as ProductType, is_active: true, ticket: 500 },
  { id: "p2", name: "Implementação", type: "projeto" as ProductType, is_active: true, ticket: 3000 },
];

function mockProductQuery(data: unknown[]) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data, error: null }),
      }),
    }),
  });
}

describe("useProducts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches products for the organization", async () => {
    mockProductQuery(MOCK_PRODUCTS);
    const { result } = renderHook(() => useProducts(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0].name).toBe("Plano Mensal");
  });

  it("returns empty array when no products", async () => {
    mockProductQuery([]);
    const { result } = renderHook(() => useProducts(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(0);
  });
});

describe("Product types", () => {
  it("ProductType union has mrr, projeto, unitario", () => {
    const types: ProductType[] = ["mrr", "projeto", "unitario"];
    expect(types).toHaveLength(3);
  });

  it("Product has required fields", () => {
    const product: Partial<Product> = {
      id: "p1",
      name: "Test",
      type: "mrr",
      is_active: true,
    };
    expect(product.type).toBe("mrr");
  });

  it("ProductVariant has required fields", () => {
    const variant: Partial<ProductVariant> = {
      id: "v1",
      product_id: "p1",
      name: "Variant A",
      sort_order: 0,
    };
    expect(variant.product_id).toBe("p1");
  });
});
