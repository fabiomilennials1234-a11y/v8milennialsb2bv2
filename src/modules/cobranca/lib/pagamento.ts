/**
 * Pagamento por título: a conta que a tela faz antes de chamar a RPC.
 *
 * `cobranca_pagamento_registrar` (20280126000000) recebe os títulos que o
 * cliente pagou e o valor recebido; valor menor que a soma abate do vencimento
 * mais antigo entre os escolhidos. A tela repete a regra para avisar antes do
 * banco recusar — quem decide continua sendo o banco.
 */
import { reais } from "./formato";
import type { TituloSaldo } from "./tipos";

/** O que a equipe baixa aqui: em aberto, com saldo e fora do ERP (esse baixa pelo ERP). */
export function titulosBaixaveis(titulos: readonly TituloSaldo[]): TituloSaldo[] {
  return titulos.filter((t) => t.status === "aberto" && t.saldo > 0 && t.origem !== "erp");
}

/** Títulos em aberto que só o ERP baixa — a tela avisa que não estão na lista. */
export function titulosSoDoErp(titulos: readonly TituloSaldo[]): number {
  return titulos.filter((t) => t.status === "aberto" && t.saldo > 0 && t.origem === "erp").length;
}

/** Soma em centavos inteiros: somar reais em float acumula erro (318,98 + 337,33). */
export function somaDosSaldos(titulos: readonly TituloSaldo[], marcados: ReadonlySet<string>): number {
  return titulos.reduce((s, t) => (marcados.has(t.id) ? s + Math.round(t.saldo * 100) : s), 0) / 100;
}

export function erroDoPagamento(valor: number | null, marcados: number, limite: number): string | undefined {
  if (marcados === 0) return "Marque ao menos um título.";
  if (valor == null || valor <= 0) return "Informe o valor recebido.";
  if (valor - limite > 0.009) return `Passa do saldo dos títulos marcados (${reais(limite)}).`;
  return undefined;
}

/** Uma linha do que o pagamento abateu — vem no retorno da RPC e no evento do histórico. */
export interface BaixaDoTitulo {
  id: string;
  numero: string | null;
  valor: number;
  quitado: boolean;
}

/** Eventos de antes de 20280126000000 não têm `titulos`: devolve lista vazia. */
export function parseBaixas(v: unknown): BaixaDoTitulo[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    .map((b) => ({
      id: String(b.id ?? ""),
      numero: typeof b.numero === "string" && b.numero ? b.numero : null,
      valor: Number(b.valor ?? 0),
      quitado: b.quitado === true,
    }));
}

const MOSTRAR_ATE = 3;

/** "título 2031.01" · "títulos 2031.01 e 2031.03" · "títulos A, B, C e mais 2"; abatimento parcial leva "(parcial)". */
export function descreverBaixas(baixas: readonly BaixaDoTitulo[]): string | null {
  if (baixas.length === 0) return null;
  const nomes = baixas.map((b) => `${b.numero ?? "sem número"}${b.quitado ? "" : " (parcial)"}`);
  const visiveis = nomes.length > MOSTRAR_ATE + 1 ? [...nomes.slice(0, MOSTRAR_ATE), `mais ${nomes.length - MOSTRAR_ATE}`] : nomes;
  const lista = visiveis.length === 1 ? visiveis[0] : `${visiveis.slice(0, -1).join(", ")} e ${visiveis[visiveis.length - 1]}`;
  return `${baixas.length === 1 ? "título" : "títulos"} ${lista}`;
}
