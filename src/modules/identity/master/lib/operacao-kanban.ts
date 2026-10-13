/**
 * Operação — o kanban de Chamados da Área Dev (board "Área Dev: 18 telas → 5
 * centrais", regras OP-1…OP-10).
 *
 * A coluna de um Chamado é DERIVADA do dado (OP-8), nunca guardada: arrastar
 * não escreve "coluna", escreve o estado que a coluna lê. Por isso o kanban não
 * tem como mentir — se o banco recusar, o cartão volta para onde estava.
 *
 *   Chamado aberto ─(diagnóstico registrado)→ Diagnóstico feito
 *     ─(alguém pega)→ Em andamento ─(resposta enviada)→ Aguardando confirmação
 *     ─(7 dias sem o cliente reabrir, cron)→ Concluído
 *
 * Fora do caminho, a feature que o time decide não construir vai para Feature
 * recusada (estado `recusado`, migration 20271117000100) — só chamado cujo
 * diagnóstico é `feature`, e só pelo master. Terminal como Concluído.
 *
 * Esse é o caminho natural. Desde a emenda de 2026-10-07 ao ADR-0018, o master
 * move LIVRE entre as colunas, em qualquer direção, pela RPC auditada
 * `master_ticket_move` (migration 20271108000300). O cliente continua só
 * reabrindo um chamado resolvido; o gatilho `enforce_support_ticket_write_rules`
 * tem a última palavra para qualquer caminho.
 */

import type { TicketStatus } from "@/modules/platform/lib/support-ticket-draft";

export const OPERACAO_COLUMNS = [
  "aberto",
  "diagnostico",
  "andamento",
  "aguardando",
  "concluido",
  "recusada",
] as const;

export type OperacaoColumn = (typeof OPERACAO_COLUMNS)[number];

export const OPERACAO_COLUMN_LABELS: Record<OperacaoColumn, string> = {
  aberto: "Chamado aberto",
  diagnostico: "Diagnóstico feito",
  andamento: "Em andamento",
  aguardando: "Aguardando confirmação",
  concluido: "Concluído",
  recusada: "Feature recusada",
};

/** O que a coluna promete a quem olha — a linha de baixo do cabeçalho. */
export const OPERACAO_COLUMN_HINTS: Record<OperacaoColumn, string> = {
  aberto: "Sem diagnóstico ainda",
  diagnostico: "Causa e prompt prontos",
  andamento: "Alguém pegou",
  aguardando: "Resolvido, aguardando o cliente",
  concluido: "Fecha sozinho em 7 dias",
  recusada: "Decidimos não construir",
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
  /** `DiagnosisKind`. Só `feature` pode ir para Feature recusada. */
  kind: string;
}

/** Colunas de chamado encerrado: só o master tira um chamado delas. */
export const CLOSED_COLUMNS: ReadonlySet<OperacaoColumn> = new Set(["concluido", "recusada"]);

/** OP-8: a coluna vem do dado. */
export function columnOf(
  ticket: Pick<OperacaoTicketFacts, "status">,
  diagnosis: OperacaoDiagnosisFacts | null,
): OperacaoColumn {
  switch (ticket.status) {
    case "fechado":
      return "concluido";
    case "recusado":
      return "recusada";
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

/**
 * O estado que o banco grava quando o master solta o cartão na coluna — o
 * mesmo mapa de `master_ticket_move`.
 */
export const OPERACAO_COLUMN_STATUS: Record<OperacaoColumn, TicketStatus> = {
  // As duas primeiras colunas são o mesmo estado: o que as separa é existir diagnóstico.
  aberto: "aberto",
  diagnostico: "aberto",
  andamento: "em_andamento",
  aguardando: "resolvido",
  concluido: "fechado",
  recusada: "recusado",
};

/**
 * O que a tela pergunta antes de gravar:
 * - `fechar`: o cliente não é avisado e só o master reabre;
 * - `resposta`: enviar a resposta pronta ao cliente, ou só mudar o estado;
 * - `recusar`: a feature não será construída; o cliente vê "Recusado";
 * - `reabrir`: o chamado estava encerrado (fechado ou recusado).
 */
export type MoveConfirmation = "fechar" | "resposta" | "recusar" | "reabrir";

/** Um movimento livre do master — uma chamada a `master_ticket_move`. */
export interface OperacaoMove {
  from: OperacaoColumn;
  to: OperacaoColumn;
  /** O estado que o banco grava. */
  status: TicketStatus;
  /** Onde o cartão fica de fato: a coluna é derivada (OP-8). */
  landsIn: OperacaoColumn;
  /** O estado já é esse (Chamado aberto ↔ Diagnóstico feito): nada a gravar. */
  noop: boolean;
  confirm: MoveConfirmation | null;
}

export type MoveVerdict =
  | { ok: true; move: OperacaoMove }
  | { ok: false; reason: string };

/**
 * Pode o cartão ir para `to`? Quando não, `reason` é o texto que a tela mostra
 * — escrito para quem arrastou, não para o log.
 *
 * Só o master move, e move livre. Quem não é master não move nada no kanban: o
 * cliente reabre um chamado resolvido pela tela dele, e o banco recusa todo o
 * resto, venha de onde vier.
 */
export function canMove(
  ticket: OperacaoTicketFacts,
  diagnosis: OperacaoDiagnosisFacts | null,
  to: OperacaoColumn,
  isMaster: boolean,
): MoveVerdict {
  if (!isMaster) {
    return { ok: false, reason: "Só o suporte move chamados no kanban." };
  }

  const from = columnOf(ticket, diagnosis);
  if (from === to) return { ok: false, reason: "O chamado já está nessa etapa." };
  if (to === "recusada" && diagnosis?.kind !== "feature") {
    return { ok: false, reason: "Só um chamado diagnosticado como feature vai para Feature recusada." };
  }

  const status = OPERACAO_COLUMN_STATUS[to];
  return {
    ok: true,
    move: {
      from,
      to,
      status,
      landsIn: columnOf({ status }, diagnosis),
      noop: status === ticket.status,
      confirm: confirmationFor(from, to),
    },
  };
}

function confirmationFor(from: OperacaoColumn, to: OperacaoColumn): MoveConfirmation | null {
  if (to === "concluido") return "fechar";
  if (to === "recusada") return "recusar";
  if (to === "aguardando") return "resposta";
  return CLOSED_COLUMNS.has(from) ? "reabrir" : null;
}

/** O que a tela diz quando o movimento não grava nada (`noop`). */
export function noopMessage(move: OperacaoMove): string {
  return move.landsIn === "diagnostico"
    ? "O chamado tem diagnóstico: continua em Diagnóstico feito."
    : "Diagnóstico feito aparece sozinho quando o diagnóstico é registrado.";
}

/** O que a tela diz quando o banco aceita o movimento. */
export function moveSuccessMessage(move: OperacaoMove, sentReply: boolean): string {
  if (move.to === "concluido") return "Chamado concluído. O cliente não foi avisado.";
  if (move.to === "recusada") return "Feature recusada. O cliente vê o chamado como Recusado.";
  if (move.to === "aguardando") {
    return sentReply
      ? "Resposta enviada. O chamado fecha sozinho em 7 dias se o cliente não reabrir."
      : "Marcado como resolvido, sem aviso ao cliente. Fecha sozinho em 7 dias.";
  }
  const reaberto = CLOSED_COLUMNS.has(move.from) ? "Chamado reaberto. " : "";
  if (move.to === "aberto" && move.landsIn === "diagnostico") {
    return `${reaberto}O chamado tem diagnóstico: voltou para Diagnóstico feito.`;
  }
  return `${reaberto}Movido para ${OPERACAO_COLUMN_LABELS[move.landsIn]}.`;
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
