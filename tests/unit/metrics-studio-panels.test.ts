/**
 * Regras puras das abas do Estúdio.
 *
 * O que estes testes protegem são as duas decisões que, se quebrarem, quebram
 * em silêncio:
 *
 *   · a ordem da aba nova sai do MAIOR `ordem`, não do tamanho da lista — senão
 *     a conta erra depois de remover uma aba do meio, e duas abas passam a
 *     disputar a mesma posição;
 *   · o nome é saneado para caber no CHECK da coluna (1–60 chars) — nome vazio
 *     ou gigante vira erro 23514 do Postgres na cara do usuário.
 */
import { describe, it, expect } from "vitest";

/**
 * Espelho das funções internas de `useMetricsStudioPanels`. Copiadas de
 * propósito: extraí-las do hook só para testar exporia detalhe interno na API
 * pública, e são cinco linhas. O acoplamento fica registrado aqui — se a regra
 * mudar no hook, este teste tem que mudar junto.
 */
function proximaOrdem(paineis: { ordem: number }[]): number {
  return paineis.reduce((max, p) => Math.max(max, p.ordem), -1) + 1;
}

function sanearNome(nome: string): string {
  const limpo = nome.trim().slice(0, 60);
  return limpo.length > 0 ? limpo : "Nova aba";
}

describe("proximaOrdem", () => {
  it("primeira aba da org nasce em 0", () => {
    expect(proximaOrdem([])).toBe(0);
  });

  it("nasce depois da última", () => {
    expect(proximaOrdem([{ ordem: 0 }, { ordem: 1 }, { ordem: 2 }])).toBe(3);
  });

  /**
   * O caso que motiva a regra: removida a aba do meio, a lista tem 2 itens mas
   * a maior ordem é 2. Usar `length` devolveria 2 — colidindo com a aba que já
   * está lá, e duas abas passariam a disputar a mesma posição.
   */
  it("com buraco no meio, NÃO reaproveita a posição existente", () => {
    const paineis = [{ ordem: 0 }, { ordem: 2 }];
    expect(proximaOrdem(paineis)).toBe(3);
    expect(proximaOrdem(paineis)).not.toBe(paineis.length);
  });

  it("aguenta ordem fora de sequência", () => {
    expect(proximaOrdem([{ ordem: 7 }, { ordem: 3 }])).toBe(8);
  });
});

describe("sanearNome", () => {
  it("apara espaço", () => {
    expect(sanearNome("  Vendas  ")).toBe("Vendas");
  });

  it("nome vazio vira rótulo padrão em vez de estourar o CHECK", () => {
    expect(sanearNome("")).toBe("Nova aba");
    expect(sanearNome("    ")).toBe("Nova aba");
  });

  /** A coluna tem `length(nome) <= 60`. Cortar aqui evita o 23514. */
  it("corta em 60 caracteres", () => {
    const gigante = "x".repeat(200);
    expect(sanearNome(gigante)).toHaveLength(60);
  });

  it("preserva nome normal intacto", () => {
    expect(sanearNome("Visão Geral")).toBe("Visão Geral");
  });
});
