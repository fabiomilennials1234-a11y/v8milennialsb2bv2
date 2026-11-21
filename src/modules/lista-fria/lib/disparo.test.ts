import { describe, expect, it } from "vitest";

import {
  CADENCIAS,
  chipPodeDispararFrio,
  dentroDaJanelaFria,
  pendenciasDoPedido,
  resumoDoDisparo,
  variaveisDesconhecidas,
  type PedidoDeDisparo,
} from "./disparo";

const pedido = (p: Partial<PedidoDeDisparo> = {}): PedidoDeDisparo => ({
  funilId: "f",
  etapaId: "e",
  mensagem: "Oi {{primeiro_nome}}",
  chipIds: ["c"],
  cadencia: "padrao",
  ...p,
});

describe("variaveisDesconhecidas", () => {
  it("aceita as quatro que o disparo preenche, nas duas grafias", () => {
    expect(variaveisDesconhecidas("{{primeiro_nome}} {nome} {{ empresa }} {segmento}")).toEqual([]);
  });
  it("aponta {{responsavel}}, sem repetir", () => {
    expect(variaveisDesconhecidas("Aqui é {{responsavel}} / {responsavel} / {{cidade}}")).toEqual(["responsavel", "cidade"]);
  });
  it("ignora spintax", () => {
    expect(variaveisDesconhecidas("{Oi|Olá} {{nome}}")).toEqual([]);
  });
});

describe("dentroDaJanelaFria (horário de Brasília)", () => {
  it("terça 13h15 está dentro", () => {
    expect(dentroDaJanelaFria(new Date("2026-11-03T16:15:00Z"))).toBe(true);
  });
  it("terça 23h está fora", () => {
    expect(dentroDaJanelaFria(new Date("2026-11-04T02:00:00Z"))).toBe(false);
  });
  it("08h00 entra e 20h00 não", () => {
    expect(dentroDaJanelaFria(new Date("2026-11-03T11:00:00Z"))).toBe(true);
    expect(dentroDaJanelaFria(new Date("2026-11-03T23:00:00Z"))).toBe(false);
  });
  it("domingo ao meio-dia está fora", () => {
    expect(dentroDaJanelaFria(new Date("2026-11-08T15:00:00Z"))).toBe(false);
  });
});

describe("chipPodeDispararFrio", () => {
  it("aceita uazapi e evolution sem reserva", () => {
    expect(chipPodeDispararFrio({ provider: "uazapi", reserved_for: null })).toBe(true);
    expect(chipPodeDispararFrio({ provider: "evolution", reserved_for: null })).toBe(true);
  });
  it("recusa canal oficial e número reservado à cobrança", () => {
    expect(chipPodeDispararFrio({ provider: "notificame", reserved_for: null })).toBe(false);
    expect(chipPodeDispararFrio({ provider: "uazapi", reserved_for: "collections" })).toBe(false);
  });
});

describe("pendenciasDoPedido", () => {
  it("pedido completo não tem pendência", () => {
    expect(pendenciasDoPedido(pedido())).toEqual([]);
  });
  it("lista o que falta, funil antes de etapa", () => {
    expect(pendenciasDoPedido(pedido({ funilId: "", etapaId: "", mensagem: " ", chipIds: [] }))).toEqual([
      "Escolha o funil.",
      "Escreva a mensagem.",
      "Escolha de qual número a mensagem sai.",
    ]);
    expect(pendenciasDoPedido(pedido({ etapaId: "" }))).toEqual(["Escolha a etapa."]);
  });
  it("barra variável que sairia vazia", () => {
    expect(pendenciasDoPedido(pedido({ mensagem: "Aqui é {{responsavel}}" }))).toEqual([
      "{{responsavel}} não existe no disparo e sairia vazio.",
    ]);
  });
  it("barra mensagem acima do limite", () => {
    expect(pendenciasDoPedido(pedido({ mensagem: "a".repeat(4001) }))[0]).toMatch(/passou de 4000/);
  });
});

describe("CADENCIAS", () => {
  it("nenhuma fica abaixo do piso de 3 s do servidor, e max >= min", () => {
    for (const c of CADENCIAS) {
      expect(c.minMs).toBeGreaterThanOrEqual(3000);
      expect(c.maxMs).toBeGreaterThanOrEqual(c.minMs);
    }
  });
});

describe("resumoDoDisparo", () => {
  it("sem contatos aguardando é um disparo comum", () => {
    expect(resumoDoDisparo(12, 0)).toEqual({ total: 12, retomada: false });
  });
  it("só contatos aguardando é retomada — o caso do disparo que falhou depois de importar", () => {
    expect(resumoDoDisparo(0, 81)).toEqual({ total: 81, retomada: true });
  });
  it("mistura soma os dois e continua sendo importação", () => {
    expect(resumoDoDisparo(5, 81)).toEqual({ total: 86, retomada: false });
  });
  it("nada para nenhum lado mantém o botão desabilitado (total 0)", () => {
    expect(resumoDoDisparo(0, 0)).toEqual({ total: 0, retomada: false });
  });
});
