/**
 * Centralized time-based variables helper.
 *
 * Provides greeting (saudação), date, and time resolved at call time
 * using the Brazil timezone (America/Sao_Paulo).
 *
 * Greeting windows:
 *   Bom dia  — 05:00 .. 11:59
 *   Boa tarde — 12:00 .. 17:59
 *   Boa noite — 18:00 .. 04:59
 */

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export interface TimeBasedVariables {
  saudacao: string;
  data: string;
  hora: string;
}

/**
 * Returns the current hour (0-23) in the given timezone.
 */
export function getHourInTimezone(now: Date = new Date(), tz: string = DEFAULT_TIMEZONE): number {
  return parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).format(now),
    10,
  );
}

/**
 * Returns the greeting string based on the hour.
 */
export function getGreeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

/**
 * Returns saudacao, data and hora based on the current time in Brazil timezone.
 */
export function getTimeBasedVariables(
  now: Date = new Date(),
  tz: string = DEFAULT_TIMEZONE,
): TimeBasedVariables {
  const hour = getHourInTimezone(now, tz);
  const saudacao = getGreeting(hour);

  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(now);

  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  return { saudacao, data, hora };
}
