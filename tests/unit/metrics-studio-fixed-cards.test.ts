/**
 * Card sob medida do Estúdio — discriminante e registry.
 *
 * O que estes testes protegem é um contrato que atravessa o banco: a chave do
 * card (`StudioWindow.fixo`) é gravada no `layout` jsonb de
 * `metrics_studio_panels`. Renomear uma chave não é refactor, é migração de
 * dado — painéis salvos apontariam para um card que deixou de existir.
 *
 * E protege o modo de falha: chave desconhecida tem que degradar para "não
 * desenha", nunca estourar. Painel gravado por uma versão mais nova do app, ou
 * card retirado do registry, não pode derrubar a tela inteira por causa de UMA
 * janela.
 */
import { describe, it, expect } from "vitest";
import {
  isFixedWindow,
  type StudioWindow,
} from "../../src/modules/analytics/lib/metrics-studio-window";
import {
  FIXED_CARDS,
  resolveFixedCard,
} from "../../src/modules/analytics/lib/metrics-studio-fixed-cards";

const janela = (extra: Partial<StudioWindow> = {}): StudioWindow => ({
  id: "w1",
  metricId: "receita",
  corte: "total",
  x: 0,
  y: 0,
  w: 280,
  h: 132,
  chart: "number",
  z: 1,
  ...extra,
});

describe("isFixedWindow", () => {
  it("janela de métrica NÃO é card sob medida", () => {
    expect(isFixedWindow(janela())).toBe(false);
  });

  it("janela com `fixo` preenchido é card sob medida", () => {
    expect(isFixedWindow(janela({ fixo: "ranking-vendedores" }))).toBe(true);
  });

  /**
   * String vazia vinda de um layout gravado torto não pode contar como card
   * sob medida: o canvas tentaria resolver `""` no registry, não acharia, e a
   * janela sumiria em vez de cair no caminho da métrica.
   */
  it("`fixo` vazio não conta — cai no caminho da métrica", () => {
    expect(isFixedWindow(janela({ fixo: "" }))).toBe(false);
  });
});

describe("resolveFixedCard", () => {
  it("resolve as chaves registradas", () => {
    for (const id of Object.keys(FIXED_CARDS)) {
      expect(resolveFixedCard(id)).toBeDefined();
    }
  });

  it("chave desconhecida devolve undefined em vez de estourar", () => {
    expect(resolveFixedCard("card-que-nao-existe")).toBeUndefined();
    expect(resolveFixedCard(undefined)).toBeUndefined();
    expect(resolveFixedCard("")).toBeUndefined();
  });

  it("toda entrada tem rótulo, descrição e tamanho padrão", () => {
    for (const [id, card] of Object.entries(FIXED_CARDS)) {
      expect(card.label, `${id} sem label`).toBeTruthy();
      expect(card.descricao, `${id} sem descrição`).toBeTruthy();
      expect(card.tamanhoPadrao.w, `${id} sem largura`).toBeGreaterThan(0);
      expect(card.tamanhoPadrao.h, `${id} sem altura`).toBeGreaterThan(0);
    }
  });

  /**
   * Trava de contrato. Se este teste falhar porque alguém RENOMEOU uma chave,
   * a correção não é atualizar o teste: é manter o id antigo como alias. Os
   * painéis já gravados em `metrics_studio_panels` referenciam estas strings.
   */
  it("as chaves gravadas no banco não mudam sem alias", () => {
    expect(Object.keys(FIXED_CARDS).sort()).toEqual([
      "campeoes-produto",
      "ranking-vendedores",
    ]);
  });
});
