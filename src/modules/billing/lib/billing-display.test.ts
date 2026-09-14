import { describe, expect, it } from "vitest";
import {
  documentUrl,
  billingDate,
  money,
  cycleLabel,
  methodLabel,
} from "./billing-display";
describe("apresentação financeira", () => {
  it("recusa URLs executáveis, HTTP e credenciais embutidas", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,oi",
      "http://example.com",
      "https://u:p@example.com",
      "invalido",
    ])
      expect(documentUrl(value)).toBeNull();
    expect(documentUrl("https://www.asaas.com/i/123")).toBe(
      "https://www.asaas.com/i/123",
    );
  });
  it("mantém valores ausentes diferentes de zero e datas inválidas legíveis", () => {
    expect(money(null)).toBe("Não informado");
    expect(money(0)).toContain("0,00");
    expect(billingDate("invalida")).toBe("Não informada");
    expect(billingDate("2026-09-14")).toBe("14/09/2026");
  });
  it("reconhece ciclos e métodos atuais e legados", () => {
    expect(cycleLabel("semester")).toBe(cycleLabel("semiannual"));
    expect(methodLabel("credit_card")).toBe("Cartão de crédito");
    expect(cycleLabel(null)).toBe("Não informado");
  });
});
