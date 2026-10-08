import { describe, expect, it } from "vitest";
import {
  formatBrDocument,
  isValidBrDocument,
  onlyDigits,
  sanitizeErpDocument,
} from "../../src/modules/leads/lib/document";
import { sanitizeDocument } from "../../supabase/functions/_shared/erp/toth-mappers";

/**
 * Documentos SINTÉTICOS, gerados aqui a partir de bases inventadas — nenhum
 * CPF/CNPJ real entra no repositório. O gerador usa a formulação clássica do
 * CPF ((soma × 10) mod 11, 10 → 0), diferente da que `document.ts` usa, para o
 * teste não ser a mesma conta conferindo a si mesma.
 */
function cpf(base9: string): string {
  const digito = (b: string) => {
    let soma = 0;
    for (let i = 0; i < b.length; i++) soma += Number(b[i]) * (b.length + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const b10 = base9 + digito(base9);
  return b10 + digito(b10);
}

function cnpj(base12: string): string {
  const digito = (b: string) => {
    // Pesos de 2 a 9, da direita para a esquerda, recomeçando.
    let soma = 0;
    for (let i = 0; i < b.length; i++) soma += Number(b[b.length - 1 - i]) * ((i % 8) + 2);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const b13 = base12 + digito(base12);
  return b13 + digito(b13);
}

const trocaDv = (doc: string) => doc.slice(0, -1) + String((Number(doc.at(-1)) + 1) % 10);

const CPF = cpf("135792468");
const CNPJ = cnpj("112223330001");

describe("isValidBrDocument", () => {
  it("aceita CPF e CNPJ com DV certo", () => {
    expect(isValidBrDocument(CPF)).toBe(true);
    expect(isValidBrDocument(CNPJ)).toBe(true);
    for (const base of ["246813579", "975318642", "100200300"]) expect(isValidBrDocument(cpf(base))).toBe(true);
    for (const base of ["445556660001", "998877660001", "102030400099"]) expect(isValidBrDocument(cnpj(base))).toBe(true);
  });

  it("recusa DV errado em qualquer um dos dois dígitos", () => {
    expect(isValidBrDocument(trocaDv(CPF))).toBe(false);
    expect(isValidBrDocument(trocaDv(CNPJ))).toBe(false);
    const primeiroDvErrado = CNPJ.slice(0, 12) + String((Number(CNPJ[12]) + 1) % 10) + CNPJ[13];
    expect(isValidBrDocument(primeiroDvErrado)).toBe(false);
  });

  it("recusa o placeholder do Toth e qualquer repetição uniforme, mesmo com DV que fecha", () => {
    expect(isValidBrDocument("0".repeat(14))).toBe(false);
    expect(isValidBrDocument("1".repeat(11))).toBe(false);
    expect(isValidBrDocument("9".repeat(14))).toBe(false);
  });

  it("recusa tamanho errado, vazio e texto com máscara (normalizar é de quem chama)", () => {
    expect(isValidBrDocument(CNPJ.slice(0, 13))).toBe(false);
    expect(isValidBrDocument(CPF + "0")).toBe(false);
    expect(isValidBrDocument("")).toBe(false);
    expect(isValidBrDocument(null)).toBe(false);
    expect(isValidBrDocument(formatBrDocument(CNPJ))).toBe(false);
  });
});

describe("onlyDigits / formatBrDocument", () => {
  it("normaliza máscara e espaços", () => {
    expect(onlyDigits(`  ${formatBrDocument(CNPJ)} `)).toBe(CNPJ);
    expect(onlyDigits(formatBrDocument(CPF))).toBe(CPF);
    expect(onlyDigits(null)).toBe("");
  });

  it("aplica a máscara de CPF e de CNPJ", () => {
    expect(formatBrDocument(CPF)).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
    expect(formatBrDocument(CNPJ)).toMatch(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/);
    expect(formatBrDocument(formatBrDocument(CNPJ))).toBe(formatBrDocument(CNPJ));
  });

  it("devolve como veio o que não tem tamanho de documento, e vazio como nulo", () => {
    expect(formatBrDocument("123")).toBe("123");
    expect(formatBrDocument(null)).toBeNull();
    expect(formatBrDocument("")).toBeNull();
  });
});

describe("sanitizeErpDocument", () => {
  it("é a mesma regra do sync do Toth (sanitizeDocument)", () => {
    const casos: unknown[] = [CPF, CNPJ, trocaDv(CNPJ), "0".repeat(14), "1".repeat(11), "123", "", null, 42, formatBrDocument(CNPJ)];
    for (const caso of casos) expect(sanitizeErpDocument(caso)).toBe(sanitizeDocument(caso));
  });

  it("descarta o placeholder de zeros e mantém documento do ERP com DV inválido", () => {
    expect(sanitizeErpDocument("0".repeat(14))).toBeNull();
    expect(sanitizeErpDocument(trocaDv(CNPJ))).toBe(trocaDv(CNPJ));
  });
});
