import { describe, expect, it, vi } from "vitest";
vi.mock("@/modules/identity", () => ({ useOrganization: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { portfolioSalesHistory } from "./useClientPortfolioPurchases";
import type { SaleEventRow } from "./useLeadsSalesMetrics";
const sale = (id: string, extra: Partial<SaleEventRow> = {}): SaleEventRow => ({
  id,
  lead_id: "lead",
  event_type: "sale",
  sale_value: 100,
  sold_at: "2026-08-14",
  reversed_event_id: null,
  ...extra,
});
describe("Histórico da carteira", () => {
  it("exclui vendas estornadas e eventos de perda", () => {
    expect(
      portfolioSalesHistory([
        sale("a"),
        sale("b"),
        sale("reversal", { reversed_event_id: "a" }),
        sale("lost", { event_type: "sale_lost" }),
      ]).map((s) => s.id),
    ).toEqual(["b"]);
  });
  it("ordena últimas compras preservando identidade e fonte", () => {
    expect(
      portfolioSalesHistory([sale("a"), sale("b", { sold_at: "2026-09-14" })]),
    ).toEqual([
      { id: "b", date: "2026-09-14", value: 100, source: "CRM" },
      { id: "a", date: "2026-08-14", value: 100, source: "CRM" },
    ]);
  });
});
