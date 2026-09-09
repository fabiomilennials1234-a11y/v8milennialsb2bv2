/**
 * A pilha de cartões do canal quente.
 *
 * Cartão rouba a tela; é o instrumento mais caro que este sistema tem. As
 * regras aqui existem todas para o mesmo fim: que ele continue valendo alguma
 * coisa depois da primeira semana. Um canto de tela cheio de cartões ensina o
 * time a olhar para o outro lado — e aí o alerta que importava também morre.
 *
 * Puro de propósito: o instante entra por parâmetro, nada de timer aqui dentro.
 */

import type { Aviso } from "./aviso-stream";

/** Acima disso o canto da tela vira parede. O excedente vai contado para o sino. */
export const TETO_DE_CARTOES = 3;

/** Mensagem e lead somem sozinhos; quem não olhou em 8 segundos vê no sino. */
export const VIDA_PADRAO_MS = 8_000;

/** Automação parada não expira: some por ação ou por dispensa explícita. */
const FIXOS = new Set(["workflow_alert", "cron_drift"]);

export interface Cartao {
  id: string;
  avisoId: string;
  tipo: string;
  titulo: string;
  descricao: string | null;
  link: string | null;
  leadId: string | null;
  groupKey: string | null;
  eventCount: number;
  fixo: boolean;
  /** Instante em que some sozinho. `null` para os fixos. */
  expiraEm: number | null;
}

export interface ResultadoDeEmpilhar {
  pilha: Cartao[];
  /** Quantos ficaram só no sino nesta operação. */
  excedente: number;
}

function daviso(aviso: Aviso, agora: number): Cartao {
  const fixo = FIXOS.has(aviso.type);
  return {
    id: aviso.group_key ?? aviso.id,
    avisoId: aviso.id,
    tipo: aviso.type,
    titulo: aviso.title,
    descricao: aviso.description,
    link: aviso.link,
    leadId: aviso.lead_id,
    groupKey: aviso.group_key,
    eventCount: aviso.event_count,
    fixo,
    expiraEm: fixo ? null : agora + VIDA_PADRAO_MS,
  };
}

/**
 * Coloca (ou atualiza) um cartão na pilha.
 *
 * Com a aba escondida, o cartão NÃO entra: o som já chamou a pessoa, e voltar
 * para uma pilha de doze cartões acumulados é pior que não ter cartão nenhum.
 * O Aviso continua no sino — nada se perde, só não interrompe duas vezes.
 */
export function empilhar(
  pilha: Cartao[],
  aviso: Aviso,
  agora: number,
  abaVisivel: boolean,
): ResultadoDeEmpilhar {
  if (!abaVisivel) return { pilha, excedente: 1 };

  const novo = daviso(aviso, agora);
  const existente = pilha.findIndex((c) => c.id === novo.id);

  if (existente >= 0) {
    // Rajada: o mesmo cartão se atualiza e reganha vida, em vez de empilhar.
    const proxima = [...pilha];
    proxima[existente] = { ...novo, expiraEm: novo.fixo ? null : agora + VIDA_PADRAO_MS };
    return { pilha: proxima, excedente: 0 };
  }

  const proxima = [...pilha, novo];
  if (proxima.length <= TETO_DE_CARTOES) return { pilha: proxima, excedente: 0 };

  // Estourou o teto: o mais antigo que PODE sair sai. Um cartão fixo nunca é
  // empurrado por um transitório — automação parada não perde a vez para uma
  // mensagem.
  const sacrificavel = proxima.findIndex((c) => !c.fixo);
  if (sacrificavel === -1) {
    // Só fixos na pilha: o novo é que fica de fora.
    return { pilha, excedente: 1 };
  }

  proxima.splice(sacrificavel, 1);
  return { pilha: proxima, excedente: 1 };
}

/** Tira da pilha os que já venceram. Os fixos ficam. */
export function expirar(pilha: Cartao[], agora: number): Cartao[] {
  return pilha.filter((c) => c.expiraEm === null || c.expiraEm > agora);
}

export function dispensar(pilha: Cartao[], id: string): Cartao[] {
  return pilha.filter((c) => c.id !== id);
}
