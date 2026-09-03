/**
 * Fronteiras de dia no FUSO DA ORG (DST-safe), a partir de um instante absoluto.
 *
 * Irmão de `utc-day.ts`: onde aquele corta a fronteira do dia em UTC, este corta
 * no wall-clock do fuso passado (`organizations.timezone`, ex. America/Sao_Paulo).
 * Usado pelos ramos `today`/`week` de `computePeriodRange` (useCommandMetrics) —
 * um lead criado 00:00–03:00 UTC (= 21:00–23:59 BRT do dia anterior) precisa
 * cair em "ontem" pro humano, não em "hoje".
 *
 * Zero dependência externa. O offset do fuso é AMOSTRADO no instante-alvo via
 * `Intl.DateTimeFormat`, então DST é tratado corretamente (a amostra pega o
 * offset vigente naquele momento, não um offset fixo).
 *
 * HARDENING multi-tenant: se `timeZone` for um IANA que o `Intl` do runtime
 * rejeita (divergência Postgres/ICU — `organizations.timezone` aceita zonas que
 * o browser pode não conhecer), NÃO deixamos o `RangeError` subir pro `useMemo`
 * de render do Dashboard (white-screen daquela org). Caímos no corte UTC de
 * `utc-day.ts` (comportamento pré-fix) — degradação silenciosa, nunca hardcode.
 */
import { startOfUTCDay, endOfUTCDay } from "@/shared/time/utc-day";

interface WallClockParts {
  year: number;
  /** 1-based (janeiro = 1). */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * `organizations.timezone` pode conter um IANA que o `Intl` do runtime (browser)
 * não conhece — `new Intl.DateTimeFormat({ timeZone })` lança `RangeError`. Se
 * esse erro subisse pro `useMemo` de render do Dashboard, viraria white-screen
 * SÓ daquela org (falha multi-tenant). Detectamos uma vez por fuso (memoizado) e
 * caímos no corte UTC — os públicos abaixo degradam pro comportamento pré-fix.
 */
const tzValidityCache = new Map<string, boolean>();
function isValidTimeZone(timeZone: string): boolean {
  const cached = tzValidityCache.get(timeZone);
  if (cached !== undefined) return cached;
  let valid: boolean;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    valid = true;
  } catch {
    valid = false;
  }
  tzValidityCache.set(timeZone, valid);
  return valid;
}

/**
 * Lê o wall-clock (ano/mês/dia/hora/min/seg) de um instante NAQUELE fuso.
 * `en-CA` + `h23` garante componentes numéricos 0-23 (meia-noite = 00, sem "24").
 * Só é chamado depois de `isValidTimeZone` passar, então não lança.
 */
function readWallClock(date: Date, timeZone: string): WallClockParts {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const out: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour ?? 0,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/**
 * Offset do fuso NO instante `date`, em ms (leste = positivo).
 * Definição: trata o wall-clock do instante como se fosse UTC e subtrai o
 * instante real. Ex.: America/Sao_Paulo (UTC-3) → -10_800_000.
 * Truncamos o instante ao segundo antes de comparar porque o wall-clock não
 * carrega ms; offsets de fuso são múltiplos de minuto, então isso é exato.
 */
function offsetMsAt(date: Date, timeZone: string): number {
  const w = readWallClock(date, timeZone);
  const wallAsUTC = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const truncated = Math.floor(date.getTime() / 1000) * 1000;
  return wallAsUTC - truncated;
}

/**
 * Converte um wall-clock org-local (componentes explícitos) no instante UTC
 * correspondente, DST-safe. Amostra o offset no palpite inicial e refina uma
 * vez re-amostrando no candidato — o refino corrige a borda de DST, onde o
 * offset do palpite difere do offset do resultado (a ~1h de gap/overlap).
 */
function wallClockToUTC(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const offset1 = offsetMsAt(new Date(guess), timeZone);
  const candidate = guess - offset1;
  const offset2 = offsetMsAt(new Date(candidate), timeZone);
  if (offset2 === offset1) return new Date(candidate);
  return new Date(guess - offset2);
}

/**
 * Data-calendário org-local do instante + dia-da-semana (segunda = 0).
 */
export function zonedDateParts(
  date: Date,
  timeZone: string,
): { y: number; m: number; d: number; weekdayMon0: number } {
  if (!isValidTimeZone(timeZone)) {
    // Fallback UTC (pré-fix): componentes locais do browser, mesma convenção do
    // startOfUTCDay/endOfUTCDay (que também leem getters locais).
    return {
      y: date.getFullYear(),
      m: date.getMonth() + 1,
      d: date.getDate(),
      weekdayMon0: (date.getDay() + 6) % 7,
    };
  }
  const w = readWallClock(date, timeZone);
  // getUTCDay da data-calendário (tratada como UTC) dá o dia-da-semana correto
  // (domingo = 0); (+6)%7 rotaciona pra segunda = 0.
  const weekdayMon0 = (new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay() + 6) % 7;
  return { y: w.year, m: w.month, d: w.day, weekdayMon0 };
}

/** Instante UTC do wall-clock 00:00:00.000 do dia-calendário org-local de `date`. */
export function zonedDayStart(date: Date, timeZone: string): Date {
  if (!isValidTimeZone(timeZone)) return startOfUTCDay(date);
  const { y, m, d } = zonedDateParts(date, timeZone);
  return wallClockToUTC(y, m, d, 0, 0, 0, 0, timeZone);
}

/** Instante UTC do wall-clock 23:59:59.999 do dia-calendário org-local de `date`. */
export function zonedDayEnd(date: Date, timeZone: string): Date {
  if (!isValidTimeZone(timeZone)) return endOfUTCDay(date);
  const { y, m, d } = zonedDateParts(date, timeZone);
  return wallClockToUTC(y, m, d, 23, 59, 59, 999, timeZone);
}

/**
 * Fronteiras de uma data-calendário org-local EXPLÍCITA (não de um instante).
 * Usadas pelo ramo `week` (segunda/domingo já derivados como datas org-local) e
 * pelo `prev` do `today` (ontem org-local) — cada dia amostra seu próprio offset,
 * então rollover de mês/ano e transições de DST ficam corretos.
 */
export function zonedDayStartOfYMD(y: number, m: number, d: number, timeZone: string): Date {
  // Fallback UTC: `new Date(y, m-1, d)` (local) round-trips pelos getters locais
  // do startOfUTCDay → Date.UTC(y, m-1, d), independente do fuso do browser.
  if (!isValidTimeZone(timeZone)) return startOfUTCDay(new Date(y, m - 1, d));
  return wallClockToUTC(y, m, d, 0, 0, 0, 0, timeZone);
}

export function zonedDayEndOfYMD(y: number, m: number, d: number, timeZone: string): Date {
  if (!isValidTimeZone(timeZone)) return endOfUTCDay(new Date(y, m - 1, d));
  return wallClockToUTC(y, m, d, 23, 59, 59, 999, timeZone);
}
