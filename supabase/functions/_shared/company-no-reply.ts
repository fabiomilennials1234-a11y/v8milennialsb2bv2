/**
 * Gatilho "Cliente aguardando resposta" (`company_no_reply`).
 *
 * Espelho do `lead_no_reply`: dispara quando o CLIENTE escreveu e a EMPRESA não
 * respondeu, por mão humana, dentro do prazo do gatilho. Quem acha os
 * candidatos é a RPC `find_leads_company_no_reply` (definição de "resposta
 * humana" e da âncora da espera documentadas na migration
 * 20280120010000). Este módulo é a parte PURA: ler a config do gatilho e medir
 * o tempo de espera — de relógio ou só em horário comercial.
 *
 * Por que o horário comercial é medido aqui e não no banco: o prazo útil não é
 * monotônico no relógio (sexta 17h + 3h úteis = segunda 11h). O banco filtra
 * pelo prazo de RELÓGIO, que é um limite inferior seguro (minutos úteis ≤
 * minutos de relógio), e aqui se decide o prazo útil de cada candidato.
 */

export const COMPANY_NO_REPLY_TRIGGER = "company_no_reply" as const;

/** Prazo padrão: 3 horas (o caso de origem, JR Tex, cobra em 180 min úteis). */
export const DEFAULT_TIMEOUT_HOURS = 3;
/** Menor prazo aceito: o cron roda por minuto; abaixo disso vira ruído. */
export const MIN_TIMEOUT_HOURS = 0.25;
/** Teto de sanidade: 30 dias. */
export const MAX_TIMEOUT_HOURS = 24 * 30;
/**
 * Espera aberta há mais que prazo + isto NÃO dispara. Sem o teto, ativar a
 * automação numa org com histórico dispararia para todo cliente que um dia
 * ficou sem resposta.
 */
export const LOOKBACK_DAYS = 7;

const DAY_KEYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;
export type DayKey = typeof DAY_KEYS[number];

export interface BusinessHours {
  days: DayKey[];
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  timezone: string;
}

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  days: ["seg", "ter", "qua", "qui", "sex"],
  startTime: "08:00",
  endTime: "18:00",
  timezone: "America/Sao_Paulo",
};

export interface CompanyNoReplyConfig {
  timeoutHours: number;
  pipelineIds: string[];
  businessHoursOnly: boolean;
  businessHours: BusinessHours;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Lê `trigger_config`. Devolve `null` quando a config é incoerente — o chamador
 * PULA o workflow (fail-closed): disparar com prazo/horário inventado seria
 * cobrar o vendedor por uma regra que ninguém configurou.
 */
export function parseCompanyNoReplyConfig(raw: unknown): CompanyNoReplyConfig | null {
  const cfg = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  let timeoutHours = DEFAULT_TIMEOUT_HOURS;
  if (cfg.timeout_hours !== undefined && cfg.timeout_hours !== null && cfg.timeout_hours !== "") {
    const n = Number(cfg.timeout_hours);
    if (!Number.isFinite(n) || n < MIN_TIMEOUT_HOURS || n > MAX_TIMEOUT_HOURS) return null;
    timeoutHours = n;
  }

  let pipelineIds: string[] = [];
  if (cfg.pipeline_ids !== undefined && cfg.pipeline_ids !== null) {
    if (!Array.isArray(cfg.pipeline_ids)) return null;
    if (cfg.pipeline_ids.some((v) => typeof v !== "string" || !UUID.test(v))) return null;
    pipelineIds = [...new Set(cfg.pipeline_ids as string[])];
  }

  const businessHoursOnly = cfg.business_hours_only === true;
  let businessHours = DEFAULT_BUSINESS_HOURS;
  if (businessHoursOnly && cfg.business_hours !== undefined && cfg.business_hours !== null) {
    if (typeof cfg.business_hours !== "object") return null;
    const bh = cfg.business_hours as Record<string, unknown>;
    const days = bh.days ?? DEFAULT_BUSINESS_HOURS.days;
    const startTime = bh.startTime ?? DEFAULT_BUSINESS_HOURS.startTime;
    const endTime = bh.endTime ?? DEFAULT_BUSINESS_HOURS.endTime;
    const timezone = bh.timezone ?? DEFAULT_BUSINESS_HOURS.timezone;
    if (!Array.isArray(days) || days.length === 0 || days.some((d) => !DAY_KEYS.includes(d as DayKey))) return null;
    if (typeof startTime !== "string" || !HHMM.test(startTime)) return null;
    if (typeof endTime !== "string" || !HHMM.test(endTime)) return null;
    if (startTime >= endTime) return null;
    if (typeof timezone !== "string" || !isValidTimeZone(timezone)) return null;
    businessHours = { days: [...new Set(days as DayKey[])], startTime, endTime, timezone };
  }

  return { timeoutHours, pipelineIds, businessHoursOnly, businessHours };
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Data civil (Y-M-D) e dia da semana de um instante no fuso. */
function localDate(ms: number, tz: string): { y: number; m: number; d: number; dow: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), dow };
}

/** Deslocamento do fuso (ms) no instante dado: local − UTC. */
function offsetMs(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Instante UTC de um horário de parede (Y-M-D HH:MM) no fuso. */
function wallToUtc(y: number, m: number, d: number, minuteOfDay: number, tz: string): number {
  const naive = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  // Duas passadas resolvem a virada de horário de verão na maioria dos casos.
  const first = naive - offsetMs(naive, tz);
  return naive - offsetMs(first, tz);
}

/**
 * Minutos dentro do horário comercial entre `fromMs` e `toMs`.
 * Percorre dia civil a dia civil no fuso da config e soma a interseção de cada
 * janela [início, fim) com o intervalo. Teto de iteração: 400 dias.
 */
export function businessMinutesBetween(fromMs: number, toMs: number, hours: BusinessHours): number {
  if (!(toMs > fromMs)) return 0;
  const start = minutesOf(hours.startTime);
  const end = minutesOf(hours.endTime);
  const allowed = new Set(hours.days.map((d) => DAY_KEYS.indexOf(d)));
  let total = 0;
  // Cursor no MEIO-DIA local do dia civil do `from`: somar 24h a partir do
  // meio-dia nunca pula nem repete dia civil, mesmo com virada de horário de
  // verão (±1h). Sempre relê a data civil do cursor.
  const first = localDate(fromMs, hours.timezone);
  let cursor = wallToUtc(first.y, first.m, first.d, 12 * 60, hours.timezone);
  for (let i = 0; i < 400; i++) {
    const { y, m, d, dow } = localDate(cursor, hours.timezone);
    const winStart = wallToUtc(y, m, d, start, hours.timezone);
    if (winStart >= toMs) break;
    if (allowed.has(dow)) {
      const winEnd = wallToUtc(y, m, d, end, hours.timezone);
      const a = Math.max(winStart, fromMs);
      const b = Math.min(winEnd, toMs);
      if (b > a) total += (b - a) / 60_000;
    }
    cursor += 24 * 3_600_000;
  }
  return total;
}

/** Minutos de espera que contam para o prazo: úteis ou de relógio. */
export function waitedMinutes(waitingSinceMs: number, nowMs: number, cfg: CompanyNoReplyConfig): number {
  if (cfg.businessHoursOnly) return businessMinutesBetween(waitingSinceMs, nowMs, cfg.businessHours);
  return Math.max(0, (nowMs - waitingSinceMs) / 60_000);
}

/** A espera já venceu o prazo configurado? */
export function isWaitOverdue(waitingSinceMs: number, nowMs: number, cfg: CompanyNoReplyConfig): boolean {
  return waitedMinutes(waitingSinceMs, nowMs, cfg) >= cfg.timeoutHours * 60;
}
