import { describe, expect, it } from "vitest";

import { crc16, novaReferencia, payloadPix, referenciaValida, textoParaPix, valorParaPix, type RecebedorPix } from "./pix";

/** Decodifica um nível de campos EMV (id de 2 + tamanho de 2 + valor), para conferir o código campo a campo. */
function decodifica(payload: string): Record<string, string> {
  const campos: Record<string, string> = {};
  let i = 0;
  while (i < payload.length) {
    const id = payload.slice(i, i + 2);
    const tam = Number(payload.slice(i + 2, i + 4));
    expect(Number.isInteger(tam)).toBe(true);
    campos[id] = payload.slice(i + 4, i + 4 + tam);
    i += 4 + tam;
  }
  expect(i).toBe(payload.length); // sem sobra nem corte
  return campos;
}

const RECEBEDOR: RecebedorPix = { chave: "123e4567-e12b-12d1-a456-426655440000", nome: "Torque Tecnologia Ltda", cidade: "São Paulo" };

describe("crc16", () => {
  it("bate com o vetor padrão do CRC-16/CCITT-FALSE", () => {
    expect(crc16("123456789")).toBe("29B1");
  });
  it("completa com zeros à esquerda até 4 dígitos", () => {
    expect(crc16("")).toBe("FFFF");
    expect(crc16("A")).toMatch(/^[0-9A-F]{4}$/);
  });
});

describe("payloadPix", () => {
  const payload = payloadPix({ recebedor: RECEBEDOR, valorCentavos: 7125, referencia: "LF1ABC" });
  const campos = decodifica(payload);

  it("traz os campos do padrão, com valor, recebedor e referência", () => {
    expect(campos["00"]).toBe("01");
    expect(campos["52"]).toBe("0000");
    expect(campos["53"]).toBe("986"); // BRL
    expect(campos["54"]).toBe("71.25");
    expect(campos["58"]).toBe("BR");
    expect(campos["59"]).toBe("TORQUE TECNOLOGIA LTDA"); // sem acento, maiúsculo
    expect(campos["60"]).toBe("SAO PAULO");
    expect(decodifica(campos["62"])["05"]).toBe("LF1ABC");
  });

  it("a conta (campo 26) leva o domínio do PIX e a chave", () => {
    const conta = decodifica(campos["26"]);
    expect(conta["00"]).toBe("br.gov.bcb.pix");
    expect(conta["01"]).toBe(RECEBEDOR.chave);
  });

  it("termina em 6304 + CRC válido (recalculado sobre todo o resto)", () => {
    expect(payload.slice(-8, -4)).toBe("6304");
    expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
  });

  it("muda o valor, muda o CRC", () => {
    const outro = payloadPix({ recebedor: RECEBEDOR, valorCentavos: 7126, referencia: "LF1ABC" });
    expect(outro.slice(-4)).not.toBe(payload.slice(-4));
  });

  it("recusa o que quebraria o código", () => {
    const base = { recebedor: RECEBEDOR, valorCentavos: 1500, referencia: "LF1" };
    expect(() => payloadPix({ ...base, valorCentavos: 0 })).toThrow(/valor/);
    expect(() => payloadPix({ ...base, valorCentavos: 12.5 })).toThrow(/valor/);
    expect(() => payloadPix({ ...base, valorCentavos: -1 })).toThrow(/valor/);
    expect(() => payloadPix({ ...base, referencia: "tem espaço" })).toThrow(/referência/);
    expect(() => payloadPix({ ...base, referencia: "A".repeat(26) })).toThrow(/referência/);
    expect(() => payloadPix({ ...base, recebedor: { ...RECEBEDOR, chave: "" } })).toThrow(/chave/);
    expect(() => payloadPix({ ...base, recebedor: { ...RECEBEDOR, chave: "x".repeat(78) } })).toThrow(/chave/);
    expect(() => payloadPix({ ...base, recebedor: { ...RECEBEDOR, nome: "***" } })).toThrow(/nome/);
  });

  it("chave de telefone e e-mail passam como foram cadastradas", () => {
    for (const chave of ["+5548999990000", "financeiro@torquecrm.com.br", "12345678000199"]) {
      const c = decodifica(decodifica(payloadPix({ recebedor: { ...RECEBEDOR, chave }, valorCentavos: 1500, referencia: "R1" }))["26"]);
      expect(c["01"]).toBe(chave);
    }
  });
});

describe("auxiliares", () => {
  it("valor em centavos vira texto com ponto, sem ponto flutuante", () => {
    expect([1, 15, 100, 1500, 7125, 90000, 99999999].map(valorParaPix)).toEqual(["0.01", "0.15", "1.00", "15.00", "71.25", "900.00", "999999.99"]);
  });

  it("texto do PIX: sem acento, sem símbolo, maiúsculo e no limite", () => {
    expect(textoParaPix("São João da Boa Vista!", 15)).toBe("SAO JOAO DA BOA");
    expect(textoParaPix("  a   b  ", 25)).toBe("A B");
  });

  it("a referência tem até 25 letras e números e muda a cada chamada", () => {
    const a = novaReferencia(1_700_000_000_000, () => 0.123);
    const b = novaReferencia(1_700_000_000_000, () => 0.9);
    expect(a).toMatch(/^[A-Z0-9]{1,25}$/);
    expect(a.startsWith("LF")).toBe(true);
    expect(a).not.toBe(b);
    expect(referenciaValida(a)).toBe(true);
    expect(novaReferencia().length).toBeLessThanOrEqual(25);
  });
});
