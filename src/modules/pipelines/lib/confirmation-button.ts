/**
 * Botão de confirmação de reunião — máquina de estados PURA (ADR-0004).
 *
 * Decide label/ação/cor do botão no card em `agendado` a partir da data da
 * reunião + status de confirmação + "agora" (injetado) no fuso da org.
 * Manual-only no v1: a IA nunca chama isto.
 */

export type ConfirmationStatus = "pendente" | "pre_confirmado" | "confirmado";

export interface ConfirmButtonInput {
  meetingDate: string | null;
  confirmationStatus: ConfirmationStatus;
  now: Date;
  orgTz: string;
}

export interface ConfirmButton {
  action: "definir_data" | "pre_confirmar" | "confirmar" | "none";
  label: string;
  tone: "neutral" | "amber" | "green";
  disabled: boolean;
}

/** YYYY-MM-DD da data no fuso indicado (data-calendário). */
function calendarDay(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function resolveConfirmButton(input: ConfirmButtonInput): ConfirmButton {
  if (!input.meetingDate) {
    return { action: "definir_data", label: "Definir data", tone: "amber", disabled: false };
  }

  // Confirmado trava o botão, independente da data.
  if (input.confirmationStatus === "confirmado") {
    return { action: "none", label: "Confirmado", tone: "green", disabled: true };
  }

  const isMeetingDay =
    calendarDay(new Date(input.meetingDate), input.orgTz) === calendarDay(input.now, input.orgTz);

  // No dia: botão vira "Confirmar" (mesmo se já pré-confirmado).
  if (isMeetingDay) {
    return { action: "confirmar", label: "Confirmar", tone: "green", disabled: false };
  }

  // Antes do dia: pré-confirmação (âmbar se já sinalizada).
  if (input.confirmationStatus === "pre_confirmado") {
    return { action: "pre_confirmar", label: "Pré-confirmado", tone: "amber", disabled: false };
  }
  return { action: "pre_confirmar", label: "Pré-confirmar", tone: "neutral", disabled: false };
}
