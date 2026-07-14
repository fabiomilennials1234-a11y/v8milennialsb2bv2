// deno-lint-ignore-file no-explicit-any
/**
 * send-window — guard de janela de envio automático por organização.
 *
 * Motivação (feedback Sorvfoods, 2026-07-14): automações enviavam texto/áudio
 * 2h-3h da madrugada. Este módulo é o ponto único de decisão: dado um
 * `trackSource` e a org, responde se um envio AUTOMÁTICO pode sair agora — e,
 * quando não, o próximo instante UTC válido para reagendar.
 *
 * Princípios:
 *  - Envio MANUAL de humano NUNCA é bloqueado (isAutomaticSource → false).
 *  - Fail-open: se a config não carrega (erro/coluna ausente), libera. Bloquear
 *    todo envio por falha transitória de leitura seria pior que o problema.
 *  - Math puro reusa quick-blast/quiet-hours.ts (mesma convenção de dias e
 *    janela meio-aberta); conversão de fuso reusa copilot/time-context.ts.
 *    Zero duplicação de lógica testada.
 */

import { nextValidSendTime, type QuietWindow } from "./quick-blast/quiet-hours.ts";
import { buildDateInTimezone } from "./copilot/time-context.ts";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";
const DEFAULT_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DEFAULT_FROM_MINUTES = 480; // 08:00
const DEFAULT_TO_MINUTES = 1260; // 21:00

/**
 * Fontes de envio consideradas AUTOMÁTICAS (sujeitas à janela). Match por
 * prefixo do trackSource — cobre "copilot-outbound", "copilot-outbound-audio",
 * "copilot-followup", "campaign", "pipe", "mass", etc. Qualquer coisa que não
 * bata (incl. "manual" e trackSource ausente) é tratada como manual → liberada.
 */
const AUTOMATIC_SOURCE_PREFIXES = [
  "copilot",
  "workflow",
  "campaign",
  "pipe",
  "mass",
  "followup",
  "reactivation",
  "outbound",
];

export interface OrgSendWindow {
  enabled: boolean;
  /** Dias permitidos, 0=domingo … 6=sábado. */
  days: number[];
  /** Abertura, minutos desde 00:00 local. */
  fromMinutes: number;
  /** Fecho (exclusivo), minutos desde 00:00 local. */
  toMinutes: number;
  /** Fuso IANA da org. */
  timezone: string;
}

export interface SendWindowDecision {
  allowed: boolean;
  /** Quando bloqueado: instante UTC da próxima abertura, p/ reagendar. */
  nextValidAt: Date | null;
  reason?: string;
}

/** True se o trackSource representa um envio automático (sujeito à janela). */
export function isAutomaticSource(source: string | null | undefined): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  if (s === "manual") return false;
  return AUTOMATIC_SOURCE_PREFIXES.some((p) => s.startsWith(p));
}

/**
 * Constrói o wall-clock local da org ("YYYY-MM-DDTHH:mm") a partir de um Date
 * absoluto, robusto a DST (Brasil não tem, mas mantém geral). Trata o quirk de
 * hour12:false devolver "24" à meia-noite em alguns runtimes.
 */
function orgLocalIso(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/**
 * Decide se um envio pode sair em `now` dada a janela. Pura — sem I/O.
 * Reusa nextValidSendTime: quando o candidato já é válido ele volta idêntico.
 */
export function evaluateSendWindow(
  win: OrgSendWindow,
  now: Date,
): SendWindowDecision {
  // Desligada ou sem dia configurado → sem restrição.
  if (!win.enabled) return { allowed: true, nextValidAt: null };
  if (!Array.isArray(win.days) || win.days.length === 0) {
    return { allowed: true, nextValidAt: null };
  }

  const localIso = orgLocalIso(now, win.timezone);
  const quiet: QuietWindow = {
    days: win.days,
    fromMinutes: win.fromMinutes,
    toMinutes: win.toMinutes,
  };
  const nextLocal = nextValidSendTime(quiet, localIso);
  if (nextLocal === localIso) {
    return { allowed: true, nextValidAt: null };
  }

  const [date, time] = nextLocal.split("T");
  const nextUtc = buildDateInTimezone(date, time, win.timezone) ??
    new Date(now.getTime() + 60 * 60 * 1000); // fail-safe: +1h
  return { allowed: false, nextValidAt: nextUtc, reason: "outside_send_window" };
}

// ============================================================================
// Loader com cache leve (mesmo padrão do gateway flag / instance-write-guard).
// ============================================================================

interface CachedWindow {
  win: OrgSendWindow;
  expiresAt: number;
}
const windowCache = new Map<string, CachedWindow>();
const WINDOW_TTL_MS = 30_000;

export async function loadOrgSendWindow(
  supabase: any,
  organizationId: string,
): Promise<OrgSendWindow> {
  const cached = windowCache.get(organizationId);
  if (cached && Date.now() < cached.expiresAt) return cached.win;

  let win: OrgSendWindow = {
    enabled: false, // fail-open: sem dado → libera
    days: DEFAULT_DAYS,
    fromMinutes: DEFAULT_FROM_MINUTES,
    toMinutes: DEFAULT_TO_MINUTES,
    timezone: DEFAULT_TIMEZONE,
  };

  try {
    const { data } = await supabase
      .from("organizations")
      .select(
        "timezone, auto_send_window_enabled, auto_send_window_from_minutes, auto_send_window_to_minutes, auto_send_window_days",
      )
      .eq("id", organizationId)
      .maybeSingle();

    if (data) {
      win = {
        enabled: data.auto_send_window_enabled ?? false,
        days: Array.isArray(data.auto_send_window_days)
          ? data.auto_send_window_days
          : DEFAULT_DAYS,
        fromMinutes: data.auto_send_window_from_minutes ?? DEFAULT_FROM_MINUTES,
        toMinutes: data.auto_send_window_to_minutes ?? DEFAULT_TO_MINUTES,
        timezone: data.timezone || DEFAULT_TIMEZONE,
      };
    }
  } catch (e) {
    console.warn("[send-window] loadOrgSendWindow failed (fail-open):", e);
  }

  windowCache.set(organizationId, {
    win,
    expiresAt: Date.now() + WINDOW_TTL_MS,
  });
  return win;
}

export function _resetSendWindowCache(): void {
  windowCache.clear();
}

/**
 * Guard de conveniência: resolve fonte + carrega janela + decide.
 * Fonte não-automática → liberado sem tocar no banco.
 */
export async function guardAutomaticSend(
  supabase: any,
  organizationId: string,
  source: string | null | undefined,
  now: Date = new Date(),
): Promise<SendWindowDecision> {
  if (!isAutomaticSource(source)) {
    return { allowed: true, nextValidAt: null };
  }
  const win = await loadOrgSendWindow(supabase, organizationId);
  return evaluateSendWindow(win, now);
}
