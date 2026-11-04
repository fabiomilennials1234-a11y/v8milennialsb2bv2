import { describe, expect, it } from "vitest";

import { ROTULO_CREDITO, parseSaldos, tipoDaFonte, type FonteDaBusca } from "./tipos";

describe("tipoDaFonte (espelha private.lista_fria_tipo_da_fonte)", () => {
  it.each<[FonteDaBusca, "normal" | "meta"]>([
    ["maps", "normal"],
    ["cnpj", "normal"],
    ["instagram", "meta"],
  ])("%s gasta crédito %s", (fonte, tipo) => expect(tipoDaFonte(fonte)).toBe(tipo));
});

describe("parseSaldos (lista_fria_saldos devolve jsonb)", () => {
  it("lê os dois saldos", () => expect(parseSaldos({ normal: 100, meta: 40 })).toEqual({ normal: 100, meta: 40 }));

  it("não confia no que veio: ausente, texto, null e lixo viram 0", () => {
    expect(parseSaldos({ normal: 7 })).toEqual({ normal: 7, meta: 0 });
    expect(parseSaldos({ normal: "100", meta: null })).toEqual({ normal: 0, meta: 0 });
    expect(parseSaldos(null)).toEqual({ normal: 0, meta: 0 });
    expect(parseSaldos(undefined)).toEqual({ normal: 0, meta: 0 });
    expect(parseSaldos([1, 2])).toEqual({ normal: 0, meta: 0 });
    expect(parseSaldos({ normal: Number.NaN, meta: Number.POSITIVE_INFINITY })).toEqual({ normal: 0, meta: 0 });
  });

  it("rótulos distintos para o usuário não confundir os saldos", () => {
    expect(ROTULO_CREDITO.normal).toBe("créditos");
    expect(ROTULO_CREDITO.meta).toBe("créditos Meta");
  });
});
