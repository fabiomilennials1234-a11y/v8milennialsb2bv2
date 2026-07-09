/**
 * support-ticket-draft — o rascunho de um Chamado, e a linha que ele vira.
 *
 * Lógica pura: sem React, sem rede. O que o formulário coleta e o que o banco
 * aceita moram aqui, num lugar só, testável sem montar componente.
 *
 * O usuário declara `impacto` — se está parado. Ele nunca declara `severidade`:
 * a criticidade depende de quantas OUTRAS Organizações foram atingidas,
 * informação que só a Torque tem. `buildTicketInsert` não emite esse campo (nem
 * `defect_url`, `status` ou atribuição) mesmo que alguém os passe: o trigger no
 * banco recusaria, e um payload que tenta é um payload que um dia passa.
 *
 * Ver docs/adr/0018-chamado-in-house-support-desk.md
 */

import type { Database, TablesInsert } from "@/integrations/supabase/types";

export type TicketTipo = Database["public"]["Enums"]["support_ticket_tipo"];
export type TicketImpacto = Database["public"]["Enums"]["support_ticket_impacto"];
export type TicketStatus = Database["public"]["Enums"]["support_ticket_status"];
export type TicketSeveridade = Database["public"]["Enums"]["support_ticket_severidade"];

/** Espelha `CHECK (length(btrim(title)) BETWEEN 3 AND 200)`. */
export const TITLE_MIN = 3;
export const TITLE_MAX = 200;

export interface TicketDraft {
  title: string;
  description: string;
  tipo?: TicketTipo;
  impacto?: TicketImpacto;
}

export type TicketDraftError =
  | "title_too_short"
  | "title_too_long"
  | "tipo_missing"
  | "impacto_missing";

export interface TicketInsertContext {
  organizationId: string;
  authorUserId: string;
  supportContext: Record<string, unknown>;
}

export function emptyTicketDraft(): TicketDraft {
  return { title: "", description: "" };
}

/**
 * Todos os erros do rascunho, não só o primeiro — o formulário mostra tudo de
 * uma vez em vez de fazer o usuário descobrir um problema por submissão.
 */
export function ticketDraftErrors(draft: Partial<TicketDraft>): TicketDraftError[] {
  const errors: TicketDraftError[] = [];
  const title = (draft.title ?? "").trim();

  if (title.length < TITLE_MIN) errors.push("title_too_short");
  else if (title.length > TITLE_MAX) errors.push("title_too_long");

  if (!draft.tipo) errors.push("tipo_missing");
  if (!draft.impacto) errors.push("impacto_missing");

  return errors;
}

export function isTicketDraftValid(draft: Partial<TicketDraft>): boolean {
  return ticketDraftErrors(draft).length === 0;
}

/**
 * Converte um rascunho válido na linha a inserir. Lança se o rascunho for
 * inválido: um insert malformado viraria uma exceção de constraint no banco,
 * longe de onde o erro nasceu.
 */
export function buildTicketInsert(
  draft: Partial<TicketDraft>,
  ctx: TicketInsertContext,
): TablesInsert<"support_tickets"> {
  const errors = ticketDraftErrors(draft);
  if (errors.length > 0) {
    throw new Error(`rascunho de chamado invalido: ${errors.join(", ")}`);
  }

  const description = (draft.description ?? "").trim();

  // Enumerado campo a campo de propósito. Um spread do rascunho carregaria
  // junto qualquer coisa que o chamador tenha anexado.
  return {
    organization_id: ctx.organizationId,
    author_user_id: ctx.authorUserId,
    title: draft.title!.trim(),
    description: description.length > 0 ? description : null,
    tipo: draft.tipo!,
    impacto: draft.impacto!,
    support_context: ctx.supportContext as never,
  };
}

// ─── Rótulos (pt-BR) ────────────────────────────────────────────────────────

export const TIPO_LABELS: Record<TicketTipo, string> = {
  bug: "Algo está quebrado",
  duvida: "Tenho uma dúvida",
  solicitacao: "Quero pedir algo",
};

/**
 * A pergunta é factual e o usuário sabe respondê-la. "Qual a severidade?" ele
 * não sabe — e responderia "crítica" sempre.
 */
export const IMPACTO_LABELS: Record<TicketImpacto, string> = {
  parado: "Sim, estou parado",
  contorno: "Consigo contornar",
  incomodo: "Não, é um incômodo",
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  aberto: "Aberto",
  em_andamento: "Em andamento",
  aguardando_cliente: "Aguardando você",
  resolvido: "Resolvido",
  fechado: "Fechado",
};

export const DRAFT_ERROR_LABELS: Record<TicketDraftError, string> = {
  title_too_short: `Descreva o assunto em pelo menos ${TITLE_MIN} caracteres.`,
  title_too_long: `O assunto passa de ${TITLE_MAX} caracteres.`,
  tipo_missing: "Escolha o que aconteceu.",
  impacto_missing: "Diga se isso te impede de trabalhar.",
};
