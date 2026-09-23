import { describe, expect, it } from "vitest";
import { renderQuoteData, quoteConfigFromTool } from "../../src/contracts/copilot/quote-document";
const base = { values: { customer: "Cliente de teste" }, items: [{ code: "A", description: "Motor", unit: "UN", quantity: "1.005", unit_price_cents: 100 }], freight_cents: 0, discount_cents: 0, tax_cents: 0, extra_cents: 0 };
describe("quote document contract", () => {
  it("rounds half cents deterministically and does not trust supplied totals", () => {
    const result = renderQuoteData({ ...base, values: { ...base.values, total: "999" } }, ["customer", "total"], ["customer"]);
    expect(result.total_cents).toBe(101);
    expect(result.values.total).toBe("1,01");
  });
  it("rejects missing customer data, fractional cents and negative totals", () => {
    expect(() => renderQuoteData({ ...base, values: {} }, ["customer"], ["customer"])).toThrow("Preencha");
    expect(() => renderQuoteData({ ...base, tax_cents: 0.5 }, ["customer"], [])).toThrow();
    expect(() => renderQuoteData({ ...base, discount_cents: 1000 }, ["customer"], [])).toThrow();
  });
  it("refuses template injection and excessive quantities", () => {
    expect(() => renderQuoteData({ ...base, values: { customer: "{{secret}}" } }, ["customer"], [])).toThrow();
    expect(() => renderQuoteData({ ...base, items: [{ ...base.items[0], quantity: "1e9" }] }, ["customer"], [])).toThrow();
  });
  it("does not turn a boolean false into PDF on save", () => {
    expect(quoteConfigFromTool({ convertToPdf: false }).convert_to_pdf).toBe(false);
    expect(quoteConfigFromTool({ convertToPdf: true }).convert_to_pdf).toBe(true);
    expect(quoteConfigFromTool({ convertToPdf: "false" }).convert_to_pdf).toBe(false);
  });
});
