/**
 * A pilha de cartões viva, com um único dono.
 *
 * Precisa ser singleton: quem escuta o tempo real (o sino, no topo) e quem
 * desenha os cartões (o canto da tela) são componentes diferentes, sem
 * ancestral comum útil. Duas cópias de estado dariam duas pilhas — e, pior,
 * dois canais de realtime.
 */

import type { Aviso } from "./aviso-stream";
import {
  dispensar,
  empilhar,
  expirar,
  type Cartao,
} from "./pilha-de-cartoes";

export interface EstadoDosCartoes {
  pilha: Cartao[];
  /** Quantos ficaram só no sino desde a última vez que a pilha esvaziou. */
  excedente: number;
}

let estado: EstadoDosCartoes = { pilha: [], excedente: 0 };
const ouvintes = new Set<() => void>();

function publicar(proximo: EstadoDosCartoes): void {
  estado = proximo;
  for (const ouvinte of ouvintes) ouvinte();
}

export function assinarCartoes(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function estadoDosCartoes(): EstadoDosCartoes {
  return estado;
}

export function mostrarCartao(aviso: Aviso, agora: number, abaVisivel: boolean): void {
  const { pilha, excedente } = empilhar(estado.pilha, aviso, agora, abaVisivel);
  publicar({ pilha, excedente: estado.excedente + excedente });
}

export function dispensarCartao(id: string): void {
  const pilha = dispensar(estado.pilha, id);
  publicar({ pilha, excedente: pilha.length === 0 ? 0 : estado.excedente });
}

export function varrerCartoesVencidos(agora: number): void {
  const pilha = expirar(estado.pilha, agora);
  if (pilha.length === estado.pilha.length) return;
  publicar({ pilha, excedente: pilha.length === 0 ? 0 : estado.excedente });
}

/** Só para teste: devolve a pilha ao estado inicial. */
export function reiniciarCartoes(): void {
  publicar({ pilha: [], excedente: 0 });
}
