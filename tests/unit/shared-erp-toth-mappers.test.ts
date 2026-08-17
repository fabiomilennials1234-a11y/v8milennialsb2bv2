/**
 * Tests for _shared/erp/toth-mappers.ts.
 *
 * Estes testes fixam o COMPORTAMENTO tolerante (casar campo sem depender de
 * caixa, acento ou separador; falhar alto quando falta identificador), não os
 * nomes de campo — que ainda são hipótese até `toth-probe` rodar contra a API
 * real. Quando o payload real chegar, os nomes viram fixture e estes testes
 * continuam valendo.
 */
import { describe, it, expect } from "vitest";
import {
  pickField,
  digitsOnly,
  extractRows,
  extractLoginToken,
  mapTothClienteToCanonical,
  TothMappingError,
} from "../../supabase/functions/_shared/erp/toth-mappers";

describe("pickField", () => {
  it("casa ignorando caixa, acento e separador", () => {
    const row = { "Razão_Social": "Café Jurerê LTDA" };
    expect(pickField(row, ["razaoSocial"])).toBe("Café Jurerê LTDA");
  });

  it("respeita a ordem dos candidatos", () => {
    const row = { nome: "Fantasia", razaoSocial: "Oficial" };
    expect(pickField(row, ["razaoSocial", "nome"])).toBe("Oficial");
  });

  it("pula candidato presente porém vazio", () => {
    const row = { email: "", emailContato: "contato@x.com" };
    expect(pickField(row, ["email", "emailContato"])).toBe("contato@x.com");
  });

  it("devolve undefined quando nenhum candidato existe", () => {
    expect(pickField({ a: 1 }, ["b", "c"])).toBeUndefined();
  });
});

describe("digitsOnly", () => {
  it("tira máscara de CNPJ", () => {
    expect(digitsOnly("12.345.678/0001-90")).toBe("12345678000190");
  });

  it("aceita número e devolve null para vazio", () => {
    expect(digitsOnly(4832631404)).toBe("4832631404");
    expect(digitsOnly("---")).toBeNull();
    expect(digitsOnly(null)).toBeNull();
  });
});

describe("extractRows", () => {
  it("aceita array cru na raiz", () => {
    expect(extractRows([{ id: 1 }, { id: 2 }])).toHaveLength(2);
  });

  it("acha a lista dentro dos envelopes prováveis", () => {
    expect(extractRows({ clientes: [{ id: 1 }] })).toHaveLength(1);
    expect(extractRows({ data: [{ id: 1 }, { id: 2 }] })).toHaveLength(2);
    expect(extractRows({ registros: [{ id: 3 }] })).toHaveLength(1);
  });

  it("descarta entradas que não são objeto", () => {
    expect(extractRows([{ id: 1 }, "lixo", null])).toHaveLength(1);
  });

  it("devolve vazio quando não reconhece o formato", () => {
    expect(extractRows({ total: 10 })).toEqual([]);
    expect(extractRows("texto")).toEqual([]);
  });
});

describe("extractLoginToken", () => {
  it("lê token da raiz e de um nível aninhado", () => {
    expect(extractLoginToken({ token: "abc" })).toBe("abc");
    expect(extractLoginToken({ data: { accessToken: "xyz" } })).toBe("xyz");
  });

  it("aceita corpo em texto puro", () => {
    expect(extractLoginToken("bF0LTn9QawdrXw==")).toBe("bF0LTn9QawdrXw==");
  });

  it("recusa texto com espaço — é mensagem de erro, não token", () => {
    expect(extractLoginToken("usuario ou senha invalidos")).toBeNull();
  });

  it("devolve null quando não há token reconhecível", () => {
    expect(extractLoginToken({ status: "ok" })).toBeNull();
  });
});

describe("mapTothClienteToCanonical", () => {
  it("mapeia identidade, documento e contato", () => {
    const canonical = mapTothClienteToCanonical({
      codigo: "1042",
      razaoSocial: "Café Jurerê Indústria LTDA",
      cnpj: "12.345.678/0001-90",
      email: "financeiro@cafejurere.com.br",
      telefone: "(48) 3263-1404",
    });

    expect(canonical.externalId).toBe("1042");
    expect(canonical.cnpj).toBe("12345678000190");
    expect(canonical.name).toBe("Café Jurerê Indústria LTDA");
    expect(canonical.email).toBe("financeiro@cafejurere.com.br");
    expect(canonical.phone).toBe("4832631404");
    expect(canonical.externalRef).toBeNull();
  });

  it("cai no nome da empresa e depois no id quando não há nome", () => {
    expect(mapTothClienteToCanonical({ id: "7", fantasia: "Jurerê" }).name).toBe("Jurerê");
    // `name` é NOT NULL na carteira — um rótulo derivado é melhor que insert quebrado.
    expect(mapTothClienteToCanonical({ id: "7" }).name).toBe("Cliente 7");
  });

  it("aceita identificador numérico", () => {
    expect(mapTothClienteToCanonical({ id: 88, nome: "X" }).externalId).toBe("88");
  });

  it("falha alto quando não há identificador — sem chave não há idempotência", () => {
    expect(() => mapTothClienteToCanonical({ nome: "Sem id" })).toThrow(TothMappingError);
  });

  it("a mensagem de erro lista os campos recebidos, para fixar o mapeamento", () => {
    expect(() => mapTothClienteToCanonical({ nome: "X", fone: "1" })).toThrow(/nome, fone/);
  });
});
