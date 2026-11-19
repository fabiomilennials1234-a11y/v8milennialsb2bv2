import { describe, expect, it } from "vitest";
import { correcaoVendaError } from "./useCorrigirVendaHistorica";

describe("correcaoVendaError", () => {
  it("traduz códigos conhecidos", () => {
    expect(correcaoVendaError({ message: "sale_not_won" })).toBe(
      "O negócio precisa estar ganho para corrigir a venda.",
    );
  });

  it("erro desconhecido carrega o código do banco para o suporte", () => {
    expect(correcaoVendaError({ message: "null value in column", code: "23502" })).toBe(
      "Não foi possível salvar a correção (código 23502). Atualize a ficha e tente novamente.",
    );
  });

  it("sem código, mantém a frase genérica", () => {
    expect(correcaoVendaError({ message: "boom" })).toBe(
      "Não foi possível salvar a correção. Atualize a ficha e tente novamente.",
    );
  });
});
