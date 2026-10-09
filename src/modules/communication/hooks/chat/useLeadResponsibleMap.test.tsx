/**
 * O dono canônico (`sale ?? pre_sale`) sai da MESMA consulta do filtro por
 * vendedor, sem round-trip extra — e o critério do filtro (`responsible_id`)
 * não muda.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { fromMock, selectMock, rows } = vi.hoisted(() => {
  const rows: { current: unknown[] } = { current: [] };
  const selectMock = vi.fn();
  const fromMock = vi.fn();
  return { fromMock, selectMock, rows };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      fromMock(table);
      const builder = {
        select: (cols: string) => {
          selectMock(cols);
          return builder;
        },
        eq: () => builder,
        in: () => Promise.resolve({ data: rows.current, error: null }),
      };
      return builder;
    },
  },
}));

import { useLeadResponsibleMap, leadOwnerId } from "./useLeadResponsibleMap";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("leadOwnerId", () => {
  it("vendas vence pré-venda", () => {
    expect(leadOwnerId({ sale_responsible_id: "s", pre_sale_responsible_id: "p" })).toBe("s");
  });
  it("sem vendas, pré-venda", () => {
    expect(leadOwnerId({ sale_responsible_id: null, pre_sale_responsible_id: "p" })).toBe("p");
  });
  it("nenhum dos dois → null", () => {
    expect(leadOwnerId({ sale_responsible_id: null, pre_sale_responsible_id: null })).toBeNull();
  });
});

describe("useLeadResponsibleMap", () => {
  beforeEach(() => {
    fromMock.mockClear();
    selectMock.mockClear();
  });

  it("uma consulta devolve o mapa do filtro (responsible_id) e o de donos (sale ?? pre_sale)", async () => {
    rows.current = [
      { id: "l1", responsible_id: "legado", sale_responsible_id: "s1", pre_sale_responsible_id: "p1" },
      { id: "l2", responsible_id: null, sale_responsible_id: null, pre_sale_responsible_id: "p2" },
      { id: "l3", responsible_id: "r3", sale_responsible_id: null, pre_sale_responsible_id: null },
    ];
    const { result } = renderHook(() => useLeadResponsibleMap(["l1", "l2", "l3"], "org-1"), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(selectMock).toHaveBeenCalledWith(
      "id, responsible_id, sale_responsible_id, pre_sale_responsible_id",
    );
    expect(result.current.map.get("l1")).toBe("legado");
    expect(result.current.map.get("l3")).toBe("r3");
    expect(result.current.ownerByLead.get("l1")).toBe("s1");
    expect(result.current.ownerByLead.get("l2")).toBe("p2");
    expect(result.current.ownerByLead.get("l3")).toBeNull();
    expect(result.current.ownerByLead.has("l3")).toBe(true);
  });

  it("sem org ou sem leads: vazio e pronto, sem consulta", () => {
    const { result } = renderHook(() => useLeadResponsibleMap([], "org-1"), { wrapper });
    expect(result.current.status).toBe("ready");
    expect(result.current.ownerByLead.size).toBe(0);
    expect(fromMock).not.toHaveBeenCalled();
  });
});
