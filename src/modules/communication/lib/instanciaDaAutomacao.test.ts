/**
 * Por qual caixa a automação responderia (D7).
 *
 * A regra é a da política `conversation` do ADR-0025: a mensagem mais recente
 * ganha, atravessando caixas e atravessando as duas tabelas.
 */
import { describe, expect, it } from "vitest";

import {
  automacaoRespondePorOutraCaixa,
  instanciaDaAutomacao,
} from "./instanciaDaAutomacao";

const carol = (quando: string | null) => ({
  instanceId: "cx-carol",
  instanceName: "Carol",
  lastMessageAt: quando,
});
const chique = (quando: string | null) => ({
  instanceId: "cx-chique",
  instanceName: "Chiquê",
  lastMessageAt: quando,
});

describe("instanciaDaAutomacao", () => {
  it("a mensagem mais recente ganha, mesmo vindo da outra caixa", () => {
    const r = instanciaDaAutomacao([
      carol("2026-09-02T13:53:26Z"),
      chique("2026-09-03T22:40:48Z"),
    ]);

    expect(r?.instanceId).toBe("cx-chique");
  });

  it("caixa sem histórico não concorre", () => {
    // O caso medido na Chique: o contato só existe no canal oficial.
    const r = instanciaDaAutomacao([carol(null), chique("2026-09-04T00:02:09Z")]);

    expect(r?.instanceName).toBe("Chiquê");
  });

  it("nenhuma caixa com histórico devolve null, e não uma caixa qualquer", () => {
    // Contato novo, chamado a partir do funil: a política `conversation` não
    // tem thread para herdar, e o motor cai nas seguintes. Apontar uma caixa
    // aqui seria inventar.
    expect(instanciaDaAutomacao([carol(null), chique(null)])).toBeNull();
    expect(instanciaDaAutomacao([])).toBeNull();
  });

  it("empate mantém a primeira — a resposta não pode dançar entre renders", () => {
    const quando = "2026-09-03T10:00:00Z";

    const r = instanciaDaAutomacao([carol(quando), chique(quando)]);

    expect(r?.instanceId).toBe("cx-carol");
  });
});

describe("automacaoRespondePorOutraCaixa", () => {
  it("avisa quando a automação usaria caixa diferente da aberta", () => {
    const automacao = instanciaDaAutomacao([
      carol("2026-09-02T13:53:26Z"),
      chique("2026-09-03T22:40:48Z"),
    ]);

    expect(automacaoRespondePorOutraCaixa("cx-carol", automacao)).toBe(true);
  });

  it("NÃO avisa quando é a mesma caixa — ruído constante mata o aviso que importa", () => {
    const automacao = instanciaDaAutomacao([
      carol("2026-09-02T13:53:26Z"),
      chique("2026-09-03T22:40:48Z"),
    ]);

    expect(automacaoRespondePorOutraCaixa("cx-chique", automacao)).toBe(false);
  });

  it("sem histórico e sem caixa aberta, não avisa nada", () => {
    expect(automacaoRespondePorOutraCaixa("cx-carol", null)).toBe(false);
    expect(
      automacaoRespondePorOutraCaixa(null, {
        instanceId: "cx-chique",
        instanceName: "Chiquê",
        quando: "2026-09-03T22:40:48Z",
      }),
    ).toBe(false);
  });
});
