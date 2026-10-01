import { describe, expect, it } from "vitest";
import { summaryConfirmationGate } from "../../../supabase/functions/agent-message/engine/summary-confirmation.ts";

const summary = [{ role: "assistant", content: "2 caixas. Entrega: Rua Teste, 100. Cadastro completo. Confere para eu encaminhar ao vendedor?" }];
describe("summary confirmation gate", () => {
  it.each(["Confere, pode registrar e encaminhar. Sem faturar ou despachar.", "Sim", "Tudo certo, pode seguir", "Pode encaminhar"])('accepts confirmation: %s', message => {
    expect(summaryConfirmationGate(message, summary).confirmed).toBe(true);
  });
  it.each(["Corrigindo: são 3 caixas, e o número da rua é 120.", "Sim, mas quero outra cor", "Não confere", "Quero comprar", "São 2 caixas", "Confere, altere a cor"])('requires new summary: %s', message => {
    expect(summaryConfirmationGate(message, summary).confirmed).toBe(false);
  });
  it("rejects confirmation before a summary exists", () => {
    expect(summaryConfirmationGate("Pode encaminhar", []).confirmed).toBe(false);
  });
  it("allows an explicit human request without registration", () => {
    expect(summaryConfirmationGate("Quero falar com um vendedor humano agora", []).humanRequested).toBe(true);
    expect(summaryConfirmationGate("Não quero falar com vendedor", []).humanRequested).toBe(false);
  });
});
