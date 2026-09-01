/**
 * O slot do Oráculo na lateral — qual forma ele assume na altura que sobrou.
 *
 * A lateral é uma coluna com prioridade explícita: topo e rodapé são
 * intocáveis, a navegação tem piso garantido, e o Oráculo recebe apenas a
 * sobra. Ele não negocia espaço com o menu; ocupa o que restou.
 */

export type DegrauDoSlot = "card" | "linha" | "icone" | "ausente";

export interface MedidaDaLateral {
  /**
   * Altura da PRÓPRIA lateral, nunca a da janela. Zoom do navegador e fonte
   * grande do sistema mudam uma sem mudar a outra.
   */
  alturaDaLateral: number;
  alturaDoTopo: number;
  alturaDoRodape: number;
  alturaNaturalDaNavegacao: number;
  colapsada: boolean;
  temBriefing: boolean;
}

/** Altura mínima em que o card completo ainda cabe. */
const ALTURA_DO_CARD = 150;
/** Altura mínima da linha única: rótulo mais o gargalo do dia truncado. */
const ALTURA_DA_LINHA = 44;
/** Altura mínima do ícone com marcador — o último degrau antes de sumir. */
const ALTURA_DO_ICONE = 36;
/**
 * Piso da navegação. Abaixo disto o menu deixa de ser navegável, então nem o
 * degrau mínimo do Oráculo pode tomar o espaço.
 */
export const PISO_DA_NAVEGACAO = 200;

export function degrauDoSlot(medida: MedidaDaLateral): DegrauDoSlot {
  const disponivel =
    medida.alturaDaLateral - medida.alturaDoTopo - medida.alturaDoRodape;
  const sobra = disponivel - medida.alturaNaturalDaNavegacao;

  // Card e linha vivem só da sobra — não negociam espaço com o menu. O ícone é
  // a exceção deliberada: garantido mesmo com o menu comprido, desde que a
  // navegação continue acima do piso. Ela rola por baixo do slot.
  const cabeOIcone = disponivel - ALTURA_DO_ICONE >= PISO_DA_NAVEGACAO;

  // Recolhida a 64px não há onde desenhar card nem linha — resta o ícone com
  // marcador, e o acesso não se perde por causa da preferência de layout. Mas
  // recolher não é passe livre: o piso da navegação continua inviolável.
  if (medida.colapsada) return cabeOIcone ? "icone" : "ausente";

  // Sem briefing não há o que preencher o card, mas a porta de entrada não
  // desaparece: ela degrada para a linha com o rótulo. Enquanto o produtor de
  // briefing não existir, este é o estado normal e não a exceção.
  if (medida.temBriefing && sobra >= ALTURA_DO_CARD) return "card";
  if (sobra >= ALTURA_DA_LINHA) return "linha";
  if (cabeOIcone) return "icone";
  return "ausente";
}

/** Quanto cada degrau consome da coluna. */
export const ALTURA_POR_DEGRAU: Record<DegrauDoSlot, number> = {
  card: ALTURA_DO_CARD,
  linha: ALTURA_DA_LINHA,
  icone: ALTURA_DO_ICONE,
  ausente: 0,
};

/**
 * Altura que sobra para a navegação depois que topo, rodapé e slot ficam com a
 * sua parte. É esta a grandeza que o piso protege — e a que o teste assere,
 * em vez de inferir o piso a partir do degrau escolhido.
 */
export function alturaDaNavegacao(medida: MedidaDaLateral): number {
  const disponivel =
    medida.alturaDaLateral - medida.alturaDoTopo - medida.alturaDoRodape;
  return disponivel - ALTURA_POR_DEGRAU[degrauDoSlot(medida)];
}
