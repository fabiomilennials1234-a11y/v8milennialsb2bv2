/**
 * Lógica de agendamento de follow-up (versão Deno para Edge Functions)
 * "Esperar até o próximo horário comercial" - espelha src/lib/copilot/followupSchedule.ts
 */

const SEND_DAY_TO_JS_DAY: Record<string, number> = {
  dom: 0,
  seg: 1,
  ter: 2,
  qua: 3,
  qui: 4,
  sex: 5,
  sab: 6,
};

interface RuleSchedule {
  sendOnlyBusinessHours: boolean;
  businessHoursStart: string;
  businessHoursEnd?: string;
  sendDays?: string[];
  timezone?: string;
}

function getLocalTimeInRuleTz(
  date: Date,
  timezone: string
): { hour: number; minute: number; dayOfWeek: number; year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const hour = parseInt(get("hour"), 10);
  const minute = parseInt(get("minute"), 10);
  const year = parseInt(get("year"), 10);
  const month = parseInt(get("month"), 10);
  const day = parseInt(get("day"), 10);
  const weekdayShort = get("weekday");
  const shortToDay: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = shortToDay[weekdayShort] ?? 1;
  return { hour, minute, dayOfWeek, year, month, day };
}

function parseTimeHHMM(s: string): { hour: number; minute: number } {
  const str = String(s || "09:00").split(".")[0];
  const [h, m] = str.split(":").map((x) => parseInt(x, 10));
  return { hour: Number.isNaN(h) ? 9 : h, minute: Number.isNaN(m) ? 0 : m };
}

function utcForLocalInTz(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string
): number {
  const noonUtc = Date.UTC(year, month - 1, day, 12, 0, 0, 0);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(noonUtc));
  const tzHour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "12", 10);
  const tzMinute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const offsetHours = tzHour - 12 + (tzMinute - 0) / 60;
  return Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0, 0);
}

function getNextWindowStartUtc(
  fromDate: Date,
  rule: { businessHoursStart: string; sendDays: string[]; timezone: string }
): Date {
  const tz = rule.timezone || "America/Sao_Paulo";
  const { hour: startHour, minute: startMinute } = parseTimeHHMM(rule.businessHoursStart);
  const allowedDays = new Set(
    (rule.sendDays || ["seg", "ter", "qua", "qui", "sex"]).map((d) => SEND_DAY_TO_JS_DAY[d] ?? 1)
  );
  const dayMs = 24 * 60 * 60 * 1000;
  let candidate = new Date(fromDate.getTime());

  for (let i = 0; i <= 7; i++) {
    const { dayOfWeek, year, month, day } = getLocalTimeInRuleTz(candidate, tz);
    if (!allowedDays.has(dayOfWeek)) {
      candidate = new Date(candidate.getTime() + dayMs);
      continue;
    }
    const utc = utcForLocalInTz(year, month, day, startHour, startMinute, tz);
    const startOfWindow = new Date(utc);
    if (startOfWindow.getTime() >= fromDate.getTime()) return startOfWindow;
    candidate = new Date(candidate.getTime() + dayMs);
  }

  return new Date(candidate.getTime() + 7 * dayMs);
}

/**
 * Retorna o instante em que o follow-up deve ser enviado.
 * Se fora do horário comercial, agenda para o início do próximo.
 */
export function getNextSendTime(rule: RuleSchedule, qualifiedAt: Date): Date {
  if (!rule.sendOnlyBusinessHours) {
    return new Date(qualifiedAt.getTime());
  }

  const tz = rule.timezone || "America/Sao_Paulo";
  const { hour, minute, dayOfWeek } = getLocalTimeInRuleTz(qualifiedAt, tz);
  const { hour: startHour, minute: startMinute } = parseTimeHHMM(rule.businessHoursStart);
  const { hour: endHour, minute: endMinute } = parseTimeHHMM(rule.businessHoursEnd ?? "18:00");
  const allowedDays = new Set(
    (rule.sendDays || ["seg", "ter", "qua", "qui", "sex"]).map((d) => SEND_DAY_TO_JS_DAY[d] ?? 1)
  );

  const timeInMinutes = hour * 60 + minute;
  const startInMinutes = startHour * 60 + startMinute;
  const endInMinutes = endHour * 60 + endMinute;
  const isWithinHours = timeInMinutes >= startInMinutes && timeInMinutes < endInMinutes;
  const isSendDay = allowedDays.has(dayOfWeek);

  if (isWithinHours && isSendDay) {
    return new Date(qualifiedAt.getTime());
  }

  return getNextWindowStartUtc(qualifiedAt, {
    businessHoursStart: rule.businessHoursStart,
    sendDays: rule.sendDays || ["seg", "ter", "qua", "qui", "sex"],
    timezone: tz,
  });
}
