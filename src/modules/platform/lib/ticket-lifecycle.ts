/**
 * ticket-lifecycle — a máquina de estados do Chamado (ADR-0018).
 *
 *   aberto → em_andamento → aguardando_cliente → resolvido → fechado
 *
 * `aberto` *significa* não triado — não existe um estado `triado`, porque status
 * a mais é status que ninguém atualiza.
 *
 * `resolvido` é a alegação de conserto do staff. `fechado` é terminal e chega
 * sozinho 7 dias depois, se a Organização não reabrir.
 *
 * **Reabrir não é um estado**: devolve o Chamado a `aberto` e incrementa um
 * contador. Um Chamado reaberto três vezes é evidência de que a correção nunca
 * pegou, e esse sinal precisa somar, não ser sobrescrito. O incremento é do
 * banco (`enforce_support_ticket_write_rules`); aqui mora só a transição.
 *
 * Lógica pura: sem React, sem banco. O "agora" entra como parâmetro — um módulo
 * que lê o relógio por dentro não pode ser testado.
 */

import type { TicketStatus } from "./support-ticket-draft";

/** Janela entre `resolvido` e o fechamento automático. */
export const AUTO_CLOSE_DAYS = 7;

export type TicketEvent =
  | "staff_start"
  | "staff_await_customer"
  | "customer_replied"
  | "staff_resolve"
  | "reopen"
  | "auto_close";

const TRANSITIONS: Record<TicketEvent, Partial<Record<TicketStatus, TicketStatus>>> = {
  staff_start: { aberto: "em_andamento", aguardando_cliente: "em_andamento" },
  staff_await_customer: { em_andamento: "aguardando_cliente" },
  customer_replied: { aguardando_cliente: "em_andamento" },
  staff_resolve: { aberto: "resolvido", em_andamento: "resolvido", aguardando_cliente: "resolvido" },
  reopen: { resolvido: "aberto" },
  auto_close: { resolvido: "fechado" },
};

/** Só o cliente pode reabrir. Tudo o mais é do suporte, ou do banco. */
const CLIENT_EVENTS = new Set<TicketEvent>(["reopen"]);

export type TransitionResult =
  | { ok: true; status: TicketStatus }
  | { ok: false; from: TicketStatus; event: TicketEvent };

export function nextStatus(from: TicketStatus, event: TicketEvent): TransitionResult {
  const to = TRANSITIONS[event][from];
  return to ? { ok: true, status: to } : { ok: false, from, event };
}

/**
 * A RLS permite ao autor dar UPDATE no próprio chamado — ele precisa, para
 * reabrir. Sem esta regra ele poderia se declarar "em andamento" ou fechar o
 * chamado antes que alguém o lesse.
 */
export function canClientTransition(event: TicketEvent): boolean {
  return CLIENT_EVENTS.has(event);
}

/** `fechado` é terminal: depois da janela, o cliente abre um chamado novo. */
export function isTerminal(status: TicketStatus): boolean {
  return status === "fechado";
}

export function isEligibleForAutoClose(
  status: TicketStatus,
  resolvedAt: Date | null,
  now: Date,
): boolean {
  if (status !== "resolvido" || !resolvedAt) return false;

  const elapsedMs = now.getTime() - resolvedAt.getTime();
  return elapsedMs >= AUTO_CLOSE_DAYS * 24 * 60 * 60 * 1000;
}
