/**
 * Tests for _shared/erp/erp-provider.ts — the provider-neutral ERP contract.
 * The capability manifest is the load-bearing idea of ADR-0020: surfaces are
 * driven by what a provider declares, not by trying and failing.
 */
import { describe, it, expect } from "vitest";
import {
  providerSupports,
  type ERPProvider,
} from "../../supabase/functions/_shared/erp/erp-provider";

const omie: ERPProvider = {
  id: "omie",
  capabilities: ["clientes", "pedidos", "notaFiscal", "receivables", "webhooks"],
};

describe("providerSupports", () => {
  it("is true for a declared capability", () => {
    expect(providerSupports(omie, "receivables")).toBe(true);
  });

  it("is false for an undeclared capability", () => {
    expect(providerSupports(omie, "produtos")).toBe(false);
  });
});
