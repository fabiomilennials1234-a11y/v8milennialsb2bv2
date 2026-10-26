import { describe, it, expect } from "vitest";
import { parsePhoneCell, MAX_EXTRA_PHONES } from "./import-phones";

describe("parsePhoneCell", () => {
  it("🔑 vírgula entre números: o primeiro vira principal, o outro vira extra", () => {
    expect(parsePhoneCell("(48) 99999-1111, (48) 98888-2222")).toEqual({
      primary: "48999991111",
      extras: ["48988882222"],
    });
  });

  it("três números, mesma ordem da célula nos extras", () => {
    expect(parsePhoneCell("48999991111, 48988882222, 48977773333")).toEqual({
      primary: "48999991111",
      extras: ["48988882222", "48977773333"],
    });
  });

  it("regra antiga do principal segue: celular antes de fixo, mesmo vindo depois", () => {
    expect(parsePhoneCell("(48) 3333-4444, (48) 99999-1111")).toEqual({
      primary: "48999991111",
      extras: ["4833334444"],
    });
  });

  it("número repetido não vira extra", () => {
    expect(parsePhoneCell("(11)94391-6340/(11)94391-6340")).toEqual({
      primary: "11943916340",
      extras: [],
    });
  });

  it("código do país 55 sai; pedaço sem 10-11 dígitos é ignorado", () => {
    expect(parsePhoneCell("+55 48 99999-1111, ramal 12, 3538-1137")).toEqual({
      primary: "48999991111",
      extras: [],
    });
  });

  it("outros separadores e texto solto continuam valendo", () => {
    expect(parsePhoneCell("(16)3234-1290 /(16)99778-0380 Bruno")).toEqual({
      primary: "16997780380",
      extras: ["1632341290"],
    });
    expect(parsePhoneCell("48999991111; 48988882222\n48977773333")).toMatchObject({
      primary: "48999991111",
      extras: ["48988882222", "48977773333"],
    });
  });

  it("célula única, vazia ou sem número válido não gera extras", () => {
    expect(parsePhoneCell("48999991111")).toEqual({ primary: "48999991111", extras: [] });
    expect(parsePhoneCell("")).toEqual({ extras: [] });
    expect(parsePhoneCell(null)).toEqual({ extras: [] });
    expect(parsePhoneCell("sem telefone")).toEqual({ extras: [] });
  });

  it("notação científica do Excel continua sendo UM número", () => {
    expect(parsePhoneCell("5,511999E+12")).toEqual({ primary: "11999000000", extras: [] });
  });

  it("teto de extras: célula com dezenas de números não vira dezenas de telefones", () => {
    const cell = Array.from({ length: 30 }, (_, i) => `4899${String(1000000 + i).slice(1)}`.padEnd(11, "0")).join(",");
    expect(parsePhoneCell(cell).extras).toHaveLength(MAX_EXTRA_PHONES);
  });
});
