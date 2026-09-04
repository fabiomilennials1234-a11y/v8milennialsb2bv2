/**
 * O contrato de um card SOB MEDIDA — e só isso.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * O registry (`metrics-studio-fixed-cards`) importa os componentes do
 * adaptador; o adaptador precisava do tipo do contexto, que morava no registry.
 * Import de valor numa direção, import de TIPO na volta — e o
 * `dependency-cruiser` reprova o ciclo do mesmo jeito, porque lê o grafo de
 * módulos e não o que sobra depois que o TypeScript apaga os tipos:
 *
 *     [no-circular] fixed-card-adapters.tsx -> metrics-studio-fixed-cards.ts
 *
 * É o MESMO caso que criou `metrics-studio-window.ts`, e a saída é a mesma: o
 * tipo não pertence a nenhum dos dois lados. Aqui ele não importa ninguém do
 * módulo, então não pode fechar ciclo com ninguém.
 *
 * Que isto tenha acontecido duas vezes no mesmo módulo diz algo: sempre que um
 * registry apontar para componentes E definir o contrato deles, o ciclo nasce.
 * O contrato vem primeiro, sozinho.
 */

import type { ComponentType } from "react";

/** O que TODO card sob medida recebe. Deliberadamente pequeno. */
export interface FixedCardContext {
  /** Intervalo global do painel — o mesmo que alimenta as janelas de métrica. */
  range: { start: Date; end: Date };
}

export interface FixedCardEntry {
  /** Rótulo no cabeçalho da janela e na lista lateral. */
  label: string;
  /** Uma linha explicando o que o card mostra — vai para o subtítulo. */
  descricao: string;
  /** Tamanho com que o card nasce ao ser solto no canvas. */
  tamanhoPadrao: { w: number; h: number };
  render: ComponentType<FixedCardContext>;
}
