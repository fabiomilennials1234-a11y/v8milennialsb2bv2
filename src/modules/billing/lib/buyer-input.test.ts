/**
 * A validação existe para o valor inválido NÃO SER ENVIADO — é assim que o CPF
 * deixa de aparecer no payload do erro. Então o que estes testes protegem não é
 * ergonomia: é o canal de PII.
 *
 * Os documentos abaixo são de teste, com dígito verificador correto, e não
 * pertencem a ninguém.
 */

import { describe, it, expect } from "vitest";
import {
  isValidCPF,
  isValidCNPJ,
  isValidTaxId,
  isValidEmail,
  onlyDigits,
  validateBuyer,
} from "./buyer-input";

describe("documento", () => {
  it("aceita CPF com dígito verificador correto, formatado ou não", () => {
    expect(isValidCPF("529.982.247-25")).toBe(true);
    expect(isValidCPF("52998224725")).toBe(true);
  });

  it("recusa o DEDO TROCADO — o erro que passa em qualquer contagem de dígitos", () => {
    // 11 dígitos, mesmo formato, um algarismo diferente: só o verificador pega.
    expect(isValidCPF("52998224726")).toBe(false);
  });

  it("recusa sequência repetida, que passa no módulo 11 e não existe na Receita", () => {
    expect(isValidCPF("11111111111")).toBe(false);
    expect(isValidCNPJ("11111111111111")).toBe(false);
  });

  it("aceita CNPJ válido e recusa o vizinho de um dígito", () => {
    expect(isValidCNPJ("11.222.333/0001-81")).toBe(true);
    expect(isValidCNPJ("11222333000182")).toBe(false);
  });

  it("isValidTaxId roteia por TAMANHO — 11 vira CPF, 14 vira CNPJ, o resto é inválido", () => {
    expect(isValidTaxId("529.982.247-25")).toBe(true);
    expect(isValidTaxId("11222333000181")).toBe(true);
    expect(isValidTaxId("1234567890")).toBe(false);
    expect(isValidTaxId("")).toBe(false);
  });

  it("onlyDigits limpa máscara sem tocar nos números", () => {
    expect(onlyDigits(" 11.222.333/0001-81 ")).toBe("11222333000181");
  });
});

describe("e-mail", () => {
  it("aceita o que o CHECK da tabela aceita", () => {
    expect(isValidEmail("  Fiscal@Exemplo.COM.BR ")).toBe(true);
  });

  it("recusa sem arroba e sem domínio", () => {
    expect(isValidEmail("sem-arroba")).toBe(false);
    expect(isValidEmail("nada@dominio")).toBe(false);
  });
});

describe("validateBuyer", () => {
  it("nada preenchido é VÁLIDO — pré-preencher é opcional, e o banco devolve noop", () => {
    expect(validateBuyer({ legalName: "", taxId: "", email: "" })).toBeNull();
  });

  it("os três válidos não produzem erro nenhum", () => {
    expect(
      validateBuyer({
        legalName: "Fábrica Exemplo LTDA",
        taxId: "11.222.333/0001-81",
        email: "fiscal@exemplo.com.br",
      }),
    ).toEqual({});
  });

  it("preenchido pela METADE é erro do conjunto, não de um campo", () => {
    const errors = validateBuyer({ legalName: "Só o nome", taxId: "", email: "" });
    expect(errors?.incomplete).toBeTruthy();
    expect(errors?.taxId).toBeUndefined();
  });

  it("documento inválido é apontado — e é o caso que impede o 22023 de existir", () => {
    const errors = validateBuyer({
      legalName: "Fulano",
      taxId: "52998224726",
      email: "fulano@exemplo.com",
    });
    expect(errors?.taxId).toBeTruthy();
  });

  it("a mensagem NÃO ecoa o documento — erro de tela vira print, chamado e log", () => {
    const errors = validateBuyer({
      legalName: "Fulano",
      taxId: "52998224726",
      email: "fulano@exemplo.com",
    });
    expect(errors?.taxId).not.toContain("529");
    expect(errors?.taxId).not.toContain("52998224726");
  });

  it("distingue tamanho errado de dígito errado — as duas correções são diferentes", () => {
    const curto = validateBuyer({ legalName: "F", taxId: "1234567", email: "a@b.co" });
    expect(curto?.taxId).toContain("11 dígitos");
    const errado = validateBuyer({ legalName: "F", taxId: "52998224726", email: "a@b.co" });
    expect(errado?.taxId).toContain("confira os dígitos");
  });
});
