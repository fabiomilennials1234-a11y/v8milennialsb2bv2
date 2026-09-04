/**
 * blast-recipient-view — derivações puras do drill-down de Disparos (#944 / PRD #941).
 *
 * Zero I/O, zero timezone do runtime: `next_release_date` é uma data-calendário
 * ("YYYY-MM-DD", vinda de addDaysIso no releaser) e a aritmética acontece em UTC
 * sobre os componentes da string — nunca via `new Date(string)` local.
 *
 * Semântica (releaser em supabase/functions/_shared/quick-blast/blast-plan.ts):
 * o releaser libera o lote `lots_released` na data `next_release_date` e avança
 * um lote por dia; deferidos por budget são empurrados pra `lot_index + 1`.
 * Logo a data PREVISTA (rótulo "previsto" — deferral pode empurrar) de um
 * recipient `pending` do lote L é `next_release_date + max(0, L - lots_released)`.
 */

export interface AwaitingLotInput {
  /** `blast_plan_recipients.lot_index` — 0-based. */
  lotIndex: number;
  /** `blast_plans.lots_released`. */
  lotsReleased: number;
  /** `blast_plans.next_release_date` — "YYYY-MM-DD" ou null (terminal/drenado). */
  nextReleaseDate: string | null;
}

export interface AwaitingLot {
  /** Número humano do lote (1-based). */
  lotNumber: number;
  /** Data prevista "YYYY-MM-DD", ou null quando o plano não tem próxima release. */
  expectedDate: string | null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Soma `days` a uma data-calendário ISO, em UTC. Null se a entrada for inválida. */
function addDaysToIsoDate(isoDate: string, days: number): string | null {
  const m = ISO_DATE.exec(isoDate);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Deriva lote humano + data prevista de um recipient `pending`. Nunca lança. */
export function deriveAwaitingLot(input: AwaitingLotInput): AwaitingLot {
  const lotNumber = input.lotIndex + 1;
  if (!input.nextReleaseDate) return { lotNumber, expectedDate: null };
  // Residual pending em lote já liberado sai na próxima release → offset >= 0.
  const offset = Math.max(0, input.lotIndex - input.lotsReleased);
  return { lotNumber, expectedDate: addDaysToIsoDate(input.nextReleaseDate, offset) };
}

/**
 * Motivo humano de um recipient `skipped`. Reasons granulares (`replied` /
 * `recency`) são gravadas pela slice do releaser (PRD #941); legado `refined`
 * e qualquer código desconhecido caem no genérico — nunca vaza código cru.
 */
export function skipReasonLabel(reason: string | null): string {
  switch (reason) {
    case "replied":
      return "Respondeu";
    case "recency":
      return "Contato recente";
    default:
      return "Cortado pelas regras do disparo";
  }
}

/**
 * Motivo humano de um recipient `failed` (ADR-0016, #948). O sync do poll
 * (failure-sync, mass-send-status) grava o reason canônico em
 * blast_plan_recipients.reason ao reclassificar sent → failed:
 * invalid_number | instance_disconnected | provider_rejected | provider_error.
 * Desconhecido/null cai no genérico — nunca vaza código cru pra UI.
 */
export function failureReasonLabel(reason: string | null): string {
  switch (reason) {
    case "invalid_number":
      return "Número inválido";
    case "instance_disconnected":
      return "Número desconectado";
    case "provider_rejected":
      return "Rejeitado pelo WhatsApp";
    default:
      // provider_error e qualquer código futuro.
      return "Erro no envio";
  }
}

/**
 * O detalhe de um destinatário `unconfirmed`.
 *
 * "Não confirmada" sozinha manda o operador adivinhar de quem é o problema. O
 * texto diz o que de fato aconteceu: a mensagem saiu, o prazo de entrega da Meta
 * venceu, e ela nunca confirmou — nem entrega, nem recusa. É ausência de
 * informação, e afirmar qualquer uma das duas seria inventar (ADR-0029, #1721).
 */
export function unconfirmedLabel(): string {
  return "Prazo de entrega vencido sem confirmação do canal";
}

/** Rótulo da tab Aguardando: "Lote N · previsto DD/MM" (só "Lote N" sem data). */
export function awaitingLotLabel(input: AwaitingLotInput): string {
  const { lotNumber, expectedDate } = deriveAwaitingLot(input);
  if (!expectedDate) return `Lote ${lotNumber}`;
  const [, month, day] = expectedDate.split("-");
  return `Lote ${lotNumber} · previsto ${day}/${month}`;
}

/**
 * Busca client-side por nome OU telefone. Nome: substring case-insensitive.
 * Telefone: compara só dígitos dos dois lados, então "(11) 98888" casa
 * "+55 11 98888-7777". Query vazia deixa tudo passar.
 */
export function recipientMatchesQuery(
  recipient: { name: string | null; phone: string | null },
  query: string,
): boolean {
  const q = query.trim();
  if (!q) return true;
  if (recipient.name?.toLowerCase().includes(q.toLowerCase())) return true;
  const qDigits = q.replace(/\D/g, "");
  if (!qDigits || !recipient.phone) return false;
  return recipient.phone.replace(/\D/g, "").includes(qDigits);
}
