/**
 * Operação — o kanban de Chamados da Área Dev (board "Área Dev: 18 telas → 5
 * centrais", regras OP-1…OP-10).
 *
 * A coluna de um Chamado é DERIVADA do dado (OP-8), nunca guardada: arrastar
 * não escreve "coluna", escreve o fato que a coluna lê (status, dono, resposta
 * enviada). Por isso o kanban não tem como mentir — se o banco recusar o fato,
 * o cartão volta para onde estava.
 *
 *   Chamado aberto ─(diagnóstico registrado)→ Diagnóstico feito
 *     ─(alguém pega)→ Em andamento ─(resposta enviada)→ Aguardando confirmação
 *     ─(7 dias sem o cliente reabrir, cron)→ Concluído
 *
 * O banco já garante OP-1…OP-7 (`enforce_support_ticket_write_rules`): ninguém
 * fecha na mão, só o cliente reabre, fechado é final. Este módulo só diz à tela
 * o que ela pode OFERECER — a última palavra é sempre do trigger.
 */

import type { TicketStatus } from "@/modules/platform/lib/support-ticket-draft";

export const OPERACAO_COLUMNS = [
  "aberto",
  "diagnostico",
  "andamento",
  "aguardando",
  "concluido",
] as const;

export type OperacaoColumn = (typeof OPERACAO_COLUMNS)[number];

export const OPERACAO_COLUMN_LABELS: Record<OperacaoColumn, string> = {
  aberto: "Chamado aberto",
  diagnostico: "Diagnóstico feito",
  andamento: "Em andamento",
  aguardando: "Aguardando confirmação",
  concluido: "Concluído",
};

/** O que a coluna promete a quem olha — a linha de baixo do cabeçalho. */
export const OPERACAO_COLUMN_HINTS: Record<OperacaoColumn, string> = {
  aberto: "Sem diagnóstico ainda",
  diagnostico: "Causa e prompt prontos",
  andamento: "Alguém pegou",
  aguardando: "Resposta enviada ao cliente",
  concluido: "Fecha sozinho em 7 dias",
};

/** OP-10: a terceira reabertura é sinal de que a correção não pegou. */
export const REOPEN_ALERT_THRESHOLD = 3;

/** O mínimo do Chamado que a derivação lê. */
export interface OperacaoTicketFacts {
  status: TicketStatus;
  reopen_count: number;
  assigned_master_user_id: string | null;
}

/** O mínimo do diagnóstico que a derivação lê. `null` = sem diagnóstico. */
export interface OperacaoDiagnosisFacts {
  customer_reply: string | null;
}

/** OP-8: a coluna vem do dado. */
export function columnOf(
  ticket: Pick<OperacaoTicketFacts, "status">,
  diagnosis: OperacaoDiagnosisFacts | null,
): OperacaoColumn {
  switch (ticket.status) {
    case "fechado":
      return "concluido";
    case "resolvido":
    case "aguardando_cliente":
      return "aguardando";
    case "em_andamento":
      return "andamento";
    case "aberto":
      return diagnosis ? "diagnostico" : "aberto";
  }
}

export function hasCustomerReply(diagnosis: OperacaoDiagnosisFacts | null): boolean {
  return !!diagnosis?.customer_reply?.trim();
}

/** O que acontece no banco quando o cartão muda de coluna. */
export type OperacaoMove =
  /** Assume o Chamado e põe em andamento — um UPDATE só. */
  | { kind: "pegar" }
  /** OP-9: envia a resposta pronta e marca Resolvido — RPC atômica. */
  | { kind: "enviar_resposta" }
  /** O cliente respondeu ao pedido de informação: volta para o trabalho. */
  | { kind: "retomar" };

export type MoveVerdict =
  | { ok: true; move: OperacaoMove }
  | { ok: false; reason: string };

/**
 * Pode o cartão ir de `from` para `to`? Quando não, `reason` é o texto que a
 * tela mostra — escrito para quem arrastou, não para o log.
 */
export function canMove(
  ticket: OperacaoTicketFacts,
  diagnosis: OperacaoDiagnosisFacts | null,
  to: OperacaoColumn,
): MoveVerdict {
  const from = columnOf(ticket, diagnosis);
  if (from === to) return { ok: false, reason: "O chamado já está nessa etapa." };

  if (from === "concluido") {
    return { ok: false, reason: "Chamado fechado é final. Problema novo vira chamado novo." };
  }

  switch (to) {
    case "aberto":
      return { ok: false, reason: "Só o cliente reabre um chamado, e só depois de Resolvido." };
    case "diagnostico":
      return { ok: false, reason: "Diagnóstico feito aparece sozinho quando o diagnóstico é registrado." };
    case "concluido":
      return { ok: false, reason: "Ninguém fecha chamado na mão: Resolvido fecha sozinho em 7 dias." };
    case "andamento":
      if (from === "aberto") {
        return { ok: false, reason: "Registre o diagnóstico antes de pegar o chamado." };
      }
      if (from === "diagnostico") return { ok: true, move: { kind: "pegar" } };
      // from === "aguardando"
      if (ticket.status === "aguardando_cliente") return { ok: true, move: { kind: "retomar" } };
      return { ok: false, reason: "A resposta já foi enviada. Se não resolveu, o cliente reabre." };
    case "aguardando":
      if (from !== "andamento") {
        return { ok: false, reason: "Pegue o chamado antes de enviar a resposta." };
      }
      if (!hasCustomerReply(diagnosis)) {
        return { ok: false, reason: "Sem resposta pronta para o cliente. Escreva no diagnóstico antes." };
      }
      return { ok: true, move: { kind: "enviar_resposta" } };
  }
}

/** OP-10. */
export function isReopenAlert(ticket: Pick<OperacaoTicketFacts, "reopen_count">): boolean {
  return ticket.reopen_count >= REOPEN_ALERT_THRESHOLD;
}

/** Agrupa por coluna mantendo a ordem de entrada (a fila já chega ordenada). */
export function groupByColumn<T extends OperacaoTicketFacts & { id: string }>(
  tickets: readonly T[],
  diagnoses: ReadonlyMap<string, OperacaoDiagnosisFacts>,
): Record<OperacaoColumn, T[]> {
  const out = Object.fromEntries(OPERACAO_COLUMNS.map((c) => [c, [] as T[]])) as Record<OperacaoColumn, T[]>;
  for (const t of tickets) out[columnOf(t, diagnoses.get(t.id) ?? null)].push(t);
  return out;
}
