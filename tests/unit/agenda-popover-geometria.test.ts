/**
 * A geometria do popover de detalhe da Agenda.
 *
 * O defeito que estes testes travam: a lixeira não exclui em um clique — ela
 * abre um bloco de confirmação NO RODAPÉ do card. Quando o card já estava
 * grudado no fim da tela, esse bloco nascia ABAIXO da borda da janela, e como
 * o card é `position: fixed` não existe rolagem que alcance os botões.
 * Medido no navegador antes do fix (janela de 640px, clique em y=410): o botão
 * "Excluir" nascia 19px fora e era inclicável.
 *
 * Por isso o caso central aqui não é "posicionar", é **reposicionar com a
 * altura NOVA** — é a chamada que faltava, não a conta.
 */
import { describe, it, expect } from "vitest";

import {
  posicionarPopover,
  POPOVER_MARGEM,
  POPOVER_TOPO,
} from "@/modules/engagement/components/agenda/agenda-helpers";

/** Janela de notebook com a barra do navegador descontada. */
const JANELA = { vw: 1366, vh: 640 };

/** Medidos no navegador, no componente real. */
const ALTURA_FECHADO = 259;
const ALTURA_COM_CONFIRMACAO = 331;
const LARGURA = 288; // `w-72`

describe("posicionarPopover", () => {
  it("clique no meio da tela: fica colado no cursor, sem grude nenhum", () => {
    const { left, top } = posicionarPopover({
      x: 500,
      y: 200,
      largura: LARGURA,
      altura: ALTURA_FECHADO,
      ...JANELA,
    });
    expect(left).toBe(514); // x + 14
    expect(top).toBe(184); // y - 16
  });

  it("clique embaixo: gruda o rodapé do card na borda de baixo", () => {
    const { top } = posicionarPopover({
      x: 500,
      y: 410,
      largura: LARGURA,
      altura: ALTURA_FECHADO,
      ...JANELA,
    });
    expect(top).toBe(JANELA.vh - ALTURA_FECHADO - POPOVER_MARGEM);
    expect(top + ALTURA_FECHADO).toBeLessThanOrEqual(JANELA.vh - POPOVER_MARGEM);
  });

  /**
   * O TESTE DA REGRESSÃO. Mesmo clique, card 72px mais alto porque a
   * confirmação abriu. Se o chamador reposicionar, cabe; era exatamente isso
   * que não acontecia.
   */
  it("card cresce depois de posicionado: com a altura nova, os botões cabem", () => {
    const clique = { x: 500, y: 410, largura: LARGURA, ...JANELA };

    const fechado = posicionarPopover({ ...clique, altura: ALTURA_FECHADO });
    const aberto = posicionarPopover({ ...clique, altura: ALTURA_COM_CONFIRMACAO });

    // Reaproveitar a posição ANTIGA com a altura NOVA é o bug: vaza da janela.
    expect(fechado.top + ALTURA_COM_CONFIRMACAO).toBeGreaterThan(JANELA.vh);

    // Recalculando, o card inteiro — inclusive o botão "Excluir", que é a
    // última coisa dentro dele — termina dentro da tela.
    expect(aberto.top + ALTURA_COM_CONFIRMACAO).toBeLessThanOrEqual(
      JANELA.vh - POPOVER_MARGEM,
    );
    expect(aberto.top).toBeLessThan(fechado.top); // subiu para caber
  });

  it("card mais alto que a janela: encosta no topo em vez de sair por baixo", () => {
    const { top } = posicionarPopover({
      x: 500,
      y: 400,
      largura: LARGURA,
      altura: 900,
      ...JANELA,
    });
    expect(top).toBe(POPOVER_TOPO);
  });

  it("clique na borda direita: espelha para o lado esquerdo do cursor", () => {
    const { left } = posicionarPopover({
      x: 1340,
      y: 200,
      largura: LARGURA,
      altura: ALTURA_FECHADO,
      ...JANELA,
    });
    expect(left).toBe(1340 - LARGURA - 14);
    expect(left + LARGURA).toBeLessThanOrEqual(JANELA.vw - POPOVER_MARGEM);
  });

  /**
   * Mesmo defeito do rodapé, no eixo horizontal: espelhar para a esquerda a
   * partir de um clique colado na borda esquerda dava `left` NEGATIVO, e o card
   * nascia fora da tela pelo outro lado.
   */
  it("clique colado na borda esquerda: nunca produz left negativo", () => {
    const { left } = posicionarPopover({
      x: 20,
      y: 200,
      largura: 1000, // card largo o bastante para não caber à direita
      altura: ALTURA_FECHADO,
      vw: 1000,
      vh: 640,
    });
    expect(left).toBeGreaterThanOrEqual(POPOVER_MARGEM);
  });

  it("nunca invade o topo, por mais alto que seja o clique", () => {
    const { top } = posicionarPopover({
      x: 500,
      y: 0,
      largura: LARGURA,
      altura: ALTURA_FECHADO,
      ...JANELA,
    });
    expect(top).toBeGreaterThanOrEqual(POPOVER_TOPO);
  });
});
