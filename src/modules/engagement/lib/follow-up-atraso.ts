/**
 * "Atrasado" de follow-up, decidido num lugar só.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ───────────────────────────────────────────
 * O produto tinha QUATRO definições de atrasado convivendo, e elas discordavam
 * entre si — o que significa que dois números na mesma tela contavam a mesma
 * linha de formas diferentes:
 *
 *   1. `QuickStats` cartão "Atrasados": `due_date < agora` — corte por
 *      INSTANTE, fuso do browser;
 *   2. `QuickStats` cartão "Pendentes": `due_date <= fim de hoje` — o que
 *      INCLUÍA os atrasados. Somar os dois cartões contava a mesma linha duas
 *      vezes;
 *   3. `useFollowUps` filtro `overdue`: `due_date < início de hoje` — corte por
 *      DIA, fuso do browser;
 *   4. `tarefas-do-dia` (aba Comando): corte no fuso da ORGANIZAÇÃO.
 *
 * O sintoma que chegou como chamado: um follow-up que vence hoje às 09:00,
 * visto às 15:00, aparecia como *Atrasado* no cartão e como *de hoje* na lista.
 * Mesma linha, dois veredictos, e nenhum dos dois errado isoladamente.
 *
 * ── A DECISÃO QUE ESTE ARQUIVO TOMA ───────────────────────────────────────
 * **Atraso é por DIA, não por instante.** Follow-up que vence hoje não está
 * atrasado às 15:00 — está atrasado amanhã. `follow_ups.due_date` carrega hora,
 * mas a hora é quando a pessoa PRETENDE tocar, não um SLA. Tratá-la como prazo
 * instantâneo pinta de vermelho a agenda inteira da tarde.
 *
 * O corte no fuso da org vem de `@/shared/time/dia-da-org`, que é onde
 * `analytics` também bebe — assim o cartão e a lista não podem divergir.
 *
 * Puro e com relógio injetável de propósito: a virada do dia é justamente o que
 * precisa ser exercitado, e ela é invisível se o relógio for lido aqui dentro.
 */

import { limitesDoDia } from "@/shared/time/dia-da-org";

export type SituacaoDeFollowUp = "atrasado" | "hoje" | "futuro";

/**
 * Onde este follow-up cai: já passou, é de hoje, ou ainda vem.
 *
 * `atrasado` = venceu num dia ANTERIOR ao de hoje. Nunca "venceu há duas
 * horas".
 */
export function situacaoDoFollowUp(
  dueDate: string | Date,
  timezone: string | null | undefined,
  agora: Date = new Date(),
): SituacaoDeFollowUp {
  const { inicioDeHoje, inicioDeAmanha } = limitesDoDia(timezone, agora);
  const venc = new Date(dueDate).getTime();
  if (venc < new Date(inicioDeHoje).getTime()) return "atrasado";
  if (venc < new Date(inicioDeAmanha).getTime()) return "hoje";
  return "futuro";
}

/** Açúcar para a UI, que só quer saber se pinta de vermelho. */
export function estaAtrasado(
  dueDate: string | Date,
  timezone: string | null | undefined,
  agora: Date = new Date(),
): boolean {
  return situacaoDoFollowUp(dueDate, timezone, agora) === "atrasado";
}
