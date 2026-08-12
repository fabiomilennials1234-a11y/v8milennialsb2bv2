/**
 * O PISO DE ASSENTOS, e por que ele precisa aparecer na tela.
 *
 * MEDIDO em produção no plano `torque-2.0` (2026-08-12): pedir 1, 2, 3, 4 ou 5
 * assentos cobra o MESMO — R$ 3.485,00. A partir de 6 o preço passa a subir por
 * assento. Não é bug do motor: o plano INCLUI 5 assentos, e assento incluído já
 * está no preço base.
 *
 * O problema é de leitura, e é caro: o operador digita 3, vê 5 no resumo, e
 * conclui que o sistema errou. Ou pior, promete "3 assentos por menos" para um
 * cliente e descobre na frente dele que o preço não cai. A tela tem que DIZER
 * o piso, em vez de deixar o operador inferir dele um bug.
 *
 * Módulo puro e separado do componente porque a regra tem um caso especial —
 * pedir MENOS que o incluído não é erro, é só preço que não cai — e regra com
 * caso especial merece teste, não inspeção visual.
 *
 * ⚠️ O QUE ESTA CAMADA NÃO CONSERTA, e não deve tentar: quem compra 12 assentos
 * hoje recebe COTA de 5, porque o gatilho de cota lê o plano e não a assinatura
 * (issue #1564). É defeito de backend, e a tela mentir mais bonito não conserta
 * — só atrasa a descoberta. Aqui a gente não promete o que o sistema não
 * entrega: o texto fala de PREÇO, que é o que esta tela decide.
 */

export interface SeatFloor {
  /** Assentos que o operador pediu. */
  requested: number;
  /** Assentos que o plano já inclui — o piso do preço. */
  included: number;
  /** Pediu menos (ou igual) que o incluído: o preço não cai daqui para baixo. */
  atFloor: boolean;
  /** Assentos cobrados à parte. Zero quando está no piso. */
  extra: number;
}

export function seatFloor(requested: number, included: number): SeatFloor {
  const safeIncluded = Number.isFinite(included) && included > 0 ? included : 0;
  const safeRequested = Number.isFinite(requested) && requested > 0 ? requested : 0;

  return {
    requested: safeRequested,
    included: safeIncluded,
    atFloor: safeRequested <= safeIncluded,
    extra: Math.max(0, safeRequested - safeIncluded),
  };
}

/**
 * O texto que o operador lê. Sai daqui, e não do JSX, porque é a frase que
 * evita o "achei que era bug" — e frase que evita erro humano merece o mesmo
 * cuidado que um comparador: um lugar só, testável.
 */
export function seatFloorMessage(floor: SeatFloor): string | null {
  if (floor.included <= 0) return null;

  if (floor.atFloor) {
    return floor.requested < floor.included
      ? `Este plano já inclui ${floor.included} assentos. Pedir menos não reduz o preço — abaixo de ${floor.included} o valor é o mesmo.`
      : `Este plano inclui ${floor.included} assentos, todos já no preço base.`;
  }

  return `${floor.included} assentos vêm no preço base; ${floor.extra} ${
    floor.extra === 1 ? "assento é cobrado" : "assentos são cobrados"
  } à parte.`;
}
