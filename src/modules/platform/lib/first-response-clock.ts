/**
 * first-response-clock — "estamos demorando?", sem mentir.
 *
 * A **Meta de Primeira Resposta** é uma *política*, não um SLA: nada foi
 * prometido a nenhuma Organização, e nenhum contrato a referencia. Ela vive num
 * lugar só, como constante por Severidade, e nunca é copiada para dentro de um
 * Chamado — gravar o prazo em cada linha significaria, no dia em que a política
 * mudasse, ou reescrever o passado ou conviver com duas políticas em vigor
 * (ADR-0018).
 *
 * O tempo em `aguardando_cliente` é **descontado**. Sem isso, um chamado em que
 * o cliente sumiu por uma semana apareceria como "staff demorou 7 dias": a
 * métrica mente, o time perde a confiança nela e para de olhar. É assim que
 * dashboard de suporte morre.
 *
 * Lógica pura, zero I/O. O "agora" entra como parâmetro.
 */

import type { TicketSeveridade } from "./support-ticket-draft";

export type FirstResponseTarget = { hours: number } | { businessDays: number };

/** A política. Um lugar só. */
export const FIRST_RESPONSE_TARGETS: Record<TicketSeveridade, FirstResponseTarget> = {
  critica: { hours: 1 },
  alta: { hours: 4 },
  media: { businessDays: 1 },
  baixa: { businessDays: 3 },
};

const DAY_MS = 24 * 60 * 60 * 1000;

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Soma dias úteis. Um chamado aberto na sexta não vence no sábado, e um aberto
 * no sábado começa a contar na segunda.
 */
export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from.getTime());
  let restantes = days;

  while (restantes > 0 || isWeekend(result)) {
    result.setTime(result.getTime() + DAY_MS);
    if (!isWeekend(result)) restantes -= 1;
  }

  return result;
}

function deadlineFrom(createdAt: Date, target: FirstResponseTarget): Date {
  return "hours" in target
    ? new Date(createdAt.getTime() + target.hours * 60 * 60 * 1000)
    : addBusinessDays(createdAt, target.businessDays);
}

export interface FirstResponseClockInput {
  severidade: TicketSeveridade | null;
  createdAt: Date;
  firstResponseAt: Date | null;
  /** Janelas de espera já fechadas, somadas pelo banco. */
  awaitingCustomerMs: number;
  /** Janela de espera ainda aberta, se houver. */
  awaitingSince: Date | null;
  now: Date;
}

export interface FirstResponseClock {
  /** `null` enquanto o chamado não foi triado — sem severidade, não há meta. */
  deadline: Date | null;
  /** Tempo decorrido descontando a espera pelo cliente. Nunca negativo. */
  elapsedMs: number;
  isOverdue: boolean;
  responded: boolean;
}

export function firstResponseClock(input: FirstResponseClockInput): FirstResponseClock {
  const { severidade, createdAt, firstResponseAt, awaitingCustomerMs, awaitingSince, now } = input;

  const responded = firstResponseAt !== null;

  // Respondido, o relógio congela: o que vier depois não é demora do suporte.
  const end = firstResponseAt ?? now;

  // A janela aberta só conta até o fim do intervalo medido. Depois da resposta,
  // uma espera que começou mais tarde é irrelevante.
  const openWindowMs =
    awaitingSince && awaitingSince < end ? end.getTime() - awaitingSince.getTime() : 0;

  const waitedMs = awaitingCustomerMs + openWindowMs;
  const elapsedMs = Math.max(0, end.getTime() - createdAt.getTime() - waitedMs);

  if (!severidade) {
    return { deadline: null, elapsedMs, isOverdue: false, responded };
  }

  const target = FIRST_RESPONSE_TARGETS[severidade];
  const baseDeadline = deadlineFrom(createdAt, target);

  // O prazo é empurrado pelo tempo em que o relógio esteve parado.
  const deadline = new Date(baseDeadline.getTime() + waitedMs);
  const targetMs = baseDeadline.getTime() - createdAt.getTime();

  return { deadline, elapsedMs, isOverdue: elapsedMs > targetMs, responded };
}
