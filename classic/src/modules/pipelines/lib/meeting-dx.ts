/**
 * Recálculo D-x — a etapa correta de um card de confirmação segundo a DATA da
 * reunião (SCRUM-637, porte 1:1 do `calculateStatusByDate` que vivia dentro de
 * `PipeConfirmacao.tsx`).
 *
 * Regra em DIAS DE CALENDÁRIO, não períodos de 24h: reunião amanhã às 8h é
 * D-1 mesmo que faltem menos de 24 horas. Etapas terminais (compareceu /
 * perdido) nunca são recalculadas; `remarcar` só sai do lugar quando a data
 * deixou de estar vencida (reunião foi remarcada para frente).
 *
 * Pura de propósito: a página unificada decide SE aplica (o funil precisa TER
 * a etapa devolvida — ver `podeAplicarDx`), esta função só responde QUAL.
 */
import { isPast, isToday, startOfDay, differenceInCalendarDays } from "date-fns";

/** Etapas que o recálculo D-x pode DEVOLVER (as colunas do trilho de prazo). */
export const DX_TARGET_KEYS = [
  "remarcar",
  "confirmacao_no_dia",
  "confirmar_d1",
  "confirmar_d2",
  "confirmar_d3",
  "confirmar_d5",
  "reuniao_marcada",
] as const;

export type DxTargetKey = (typeof DX_TARGET_KEYS)[number];

/** Etapas terminais que o recálculo nunca toca. */
const TERMINAL_KEYS = new Set(["compareceu", "perdido", "remarcar"]);

export function calcularEtapaPorDataDaReuniao(
  meetingDate: Date | null,
  currentStatus: string,
): DxTargetKey | null {
  if (!meetingDate) return null;

  // Etapas terminais não são auto-atualizadas — exceto `remarcar`, que
  // recalcula quando a reunião deixou de estar vencida (data movida pra frente).
  if (TERMINAL_KEYS.has(currentStatus)) {
    if (currentStatus === "remarcar") {
      if (!isPast(startOfDay(meetingDate)) || isToday(meetingDate)) {
        // Não está mais vencida — segue para o recálculo abaixo.
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  const today = startOfDay(new Date());
  const meetingDay = startOfDay(meetingDate);
  const calendarDays = differenceInCalendarDays(meetingDay, today);

  if (calendarDays < 0) return "remarcar";
  if (calendarDays === 0) return "confirmacao_no_dia";
  if (calendarDays === 1) return "confirmar_d1";
  if (calendarDays === 2) return "confirmar_d2";
  if (calendarDays === 3) return "confirmar_d3";
  if (calendarDays === 4 || calendarDays === 5) return "confirmar_d5";
  if (calendarDays > 5) return "reuniao_marcada";

  return null;
}

/**
 * O recálculo só se aplica quando o funil TEM a etapa devolvida — um funil
 * custom com etapas `meeting_*` mas sem o trilho D-x não deve receber moves
 * para colunas que não existem nele. Generalização por PRESENÇA, não por slug:
 * qualquer funil (sistema ou custom) que monte as colunas D-x ganha o motor.
 */
export function podeAplicarDx(
  stageKeys: ReadonlySet<string>,
  target: DxTargetKey | null,
): target is DxTargetKey {
  return target !== null && stageKeys.has(target);
}
