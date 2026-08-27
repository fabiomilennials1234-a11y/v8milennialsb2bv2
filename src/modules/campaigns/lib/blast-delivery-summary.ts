/**
 * blast-delivery-summary — o resumo de um Disparo: quem está em que estado, e
 * quanto ele custou de previsto e de realizado (#1724).
 *
 * Puro, zero I/O. Quem busca as linhas é `useBlastPlanProgress`.
 *
 * ── POR QUE OS DOIS CUSTOS SÃO NÚMEROS DIFERENTES ───────────────────────────
 * A Meta cobra NA ENTREGA (ADR-0029). Previsto é a soma do que SAIU — a conta
 * que se esperava pagar no momento do envio. Realizado é a soma do que foi
 * ENTREGUE — o número que tem de bater com a fatura. A diferença entre os dois é
 * exatamente o que não chegou, e é por isso que eles aparecem separados em vez de
 * um substituir o outro.
 *
 * ── POR QUE A SOMA É INTEIRA ────────────────────────────────────────────────
 * As colunas são `numeric(12,4)` — quatro casas de propósito: o utility custa
 * R$ 0,0350 e duas casas dariam R$ 0,04, 14% de erro por mensagem, num número que
 * o Teto de Gasto (#1725) vai usar como trava em reais (#1721).
 *
 * O PostgREST devolve `numeric` como STRING justamente para não perder precisão.
 * Somar em `Number` a jogaria fora no primeiro passo — `0.035 * 10` é
 * `0.34999999999999997`. Então a unidade interna é o DÉCIMO DE MILÉSIMO inteiro,
 * e a divisão por 10.000 acontece só na hora de formatar.
 *
 * ── NULL É RESPOSTA ─────────────────────────────────────────────────────────
 * Ninguém carimba preço ainda — a tabela de preços versionada é a #1725. Soma de
 * nada é `null`, que quer dizer "não sei quanto custou". Zero AFIRMARIA "custou
 * nada". A tela mostra travessão, nunca R$ 0,00.
 */

/** Quatro casas decimais: a mesma escala de `numeric(12,4)`. */
export const ESCALA_DO_CUSTO = 10_000;

/**
 * Soma valores de custo em décimos de milésimo inteiros.
 *
 * `null` quando NENHUM valor era conhecido — e só nesse caso. Um valor conhecido
 * no meio de nulos produz um total parcial, que é mais verdadeiro que nada.
 */
export function somarEmDecimosDeMilesimo(
  valores: readonly (string | number | null | undefined)[],
): number | null {
  let total = 0;
  let houveValor = false;

  for (const v of valores) {
    if (v === null || v === undefined || v === "") continue;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    total += Math.round(n * ESCALA_DO_CUSTO);
    houveValor = true;
  }

  return houveValor ? total : null;
}

/** O que o resumo precisa de cada linha. Nada além disto é lido. */
export interface LinhaDoResumo {
  status: string;
  estimated_cost?: string | number | null;
  actual_cost?: string | number | null;
}

export interface ResumoDoDisparo {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  failed: number;
  skipped: number;
  unconfirmed: number;
  /**
   * Estados que este código não conhece.
   *
   * Existe porque o antecessor tinha um BALDE: `else p.pending += 1`
   * (`useBlastPlans.ts:170`). Enquanto ninguém escrevia estado novo ele era
   * inerte; no dia em que `delivered` fosse gravado, a entrega apareceria na tela
   * como "Aguardando" e ninguém saberia por quê. Contar o desconhecido como
   * desconhecido é o que faz o próximo estado novo aparecer em vez de se
   * esconder.
   */
  desconhecidos: number;
  /** Décimos de milésimo. `null` = preço não carimbado — exiba travessão. */
  custoPrevisto: number | null;
  /** Décimos de milésimo. `null` = preço não carimbado — exiba travessão. */
  custoRealizado: number | null;
  /**
   * A leitura não viu a audiência inteira (o teto de páginas foi atingido).
   *
   * Existe porque um total truncado NÃO PARECE truncado — parece um valor. Esse é
   * o argumento inteiro pelo qual a paginação entrou nesta fatia, e ele se aplica
   * ao próprio teto: um Disparo maior que o teto somaria dinheiro pela metade e
   * mostraria o número com a mesma cara de sempre.
   *
   * Quando isto é `true`, os DOIS custos vêm `null` — desconhecido, não parcial.
   * Um número de fatura pela metade é pior que travessão.
   */
  truncado: boolean;
}

/** Os estados em que a mensagem JÁ SAIU — é o universo do custo previsto. */
const JA_SAIU = new Set(["sent", "delivered", "failed", "unconfirmed"]);

export function resumirDestinatarios(
  linhas: readonly LinhaDoResumo[],
  /** A leitura parou no teto de páginas sem chegar ao fim da audiência. */
  truncado = false,
): ResumoDoDisparo {
  const r: ResumoDoDisparo = {
    total: linhas.length,
    pending: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    skipped: 0,
    unconfirmed: 0,
    desconhecidos: 0,
    custoPrevisto: null,
    custoRealizado: null,
    truncado,
  };

  const previstos: (string | number | null | undefined)[] = [];
  const realizados: (string | number | null | undefined)[] = [];

  for (const l of linhas) {
    switch (l.status) {
      case "pending": r.pending += 1; break;
      case "sent": r.sent += 1; break;
      case "delivered": r.delivered += 1; break;
      case "failed": r.failed += 1; break;
      case "skipped": r.skipped += 1; break;
      case "unconfirmed": r.unconfirmed += 1; break;
      default: r.desconhecidos += 1; break;
    }

    if (JA_SAIU.has(l.status)) previstos.push(l.estimated_cost);
    if (l.status === "delivered") realizados.push(l.actual_cost);
  }

  // Soma parcial de dinheiro não é uma soma: é um número errado com cara de
  // certo. Truncou, não responde.
  r.custoPrevisto = truncado ? null : somarEmDecimosDeMilesimo(previstos);
  r.custoRealizado = truncado ? null : somarEmDecimosDeMilesimo(realizados);
  return r;
}

/**
 * Quantas pessoas o Disparo JÁ PROCESSOU — a base da barra de progresso.
 *
 * ⚠️ `delivered` e `unconfirmed` PRECISAM estar aqui. Eles são destinos de
 * `sent`: quando o callback confirma a entrega, a linha SAI de `sent`. Sem os
 * dois, cada confirmação tiraria uma pessoa da conta e a barra andaria PARA TRÁS.
 *
 * Vive aqui, e não em cada tela, porque eram duas telas calculando a mesma soma
 * — e um sétimo estado obrigaria a lembrar das duas.
 */
export function processados(r: ResumoDoDisparo): number {
  return r.sent + r.delivered + r.unconfirmed + r.skipped + r.failed + r.desconhecidos;
}

/**
 * Quantas pessoas RECEBERAM O ENVIO — o número que a tela chama de "enviados".
 *
 * `delivered` e `unconfirmed` entram: a linha entregue foi enviada, e mostrar só
 * `sent` faria o número CAIR conforme as confirmações chegassem.
 *
 * `failed` fica FORA, e isto é regra antiga desta tela, não preferência:
 * a falha aparece no seu próprio contador, ao lado. Somá-la aqui contaria a mesma
 * pessoa duas vezes na mesma linha ("12 enviados · 3 falhas" com 12 já incluindo
 * as 3).
 */
export function saiuDaFila(r: ResumoDoDisparo): number {
  return r.sent + r.delivered + r.unconfirmed;
}

/**
 * Formata um total de custo em reais.
 *
 * `null` vira travessão, e isso é uma decisão, não um detalhe: enquanto o preço
 * não é carimbado, "R$ 0,00" afirmaria que o Disparo foi de graça. O travessão
 * diz "não sei", que é a verdade. Decisão do CTO, registrada — mantenha mesmo que
 * alguém ache feio.
 */
export function formatarCusto(decimosDeMilesimo: number | null): string {
  if (decimosDeMilesimo === null) return "—";
  return (decimosDeMilesimo / ESCALA_DO_CUSTO).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
