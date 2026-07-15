/**
 * Time-Aware Behavior — resolver de janela ativa por timezone do agente.
 *
 * Lê copilot_agents.behavior_windows (JSONB) + availability.timezone, computa
 * dia/hora correntes em TZ do agente, devolve primeira janela que casa.
 *
 * Modelo de janela:
 *   { id, name, days: ('mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun')[],
 *     start: 'HH:MM', end: 'HH:MM', behavior: string }
 *
 * Regras:
 *   - First-match wins (ordem do array é prioridade)
 *   - end > start: janela mesmo-dia
 *   - end <= start: wraps midnight (ex: 22:00–06:00 cobre 22h até 06h dia seguinte)
 *   - Sem janela ativa → null (caller decide fallback)
 */

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface BehaviorWindow {
  id: string;
  name: string;
  days: DayKey[];
  start: string;
  end: string;
  behavior: string;
}

export interface ResolvedTimeContext {
  window: BehaviorWindow;
  /** Texto pronto pra injeção no prompt — multi-line. */
  formatted: string;
  /** True se janela tem behavior preenchido (não-vazio). */
  hasBehavior: boolean;
}

const WEEKDAY_INDEX: Record<DayKey, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const DAY_LABEL: Record<DayKey, string> = {
  mon: "segunda-feira",
  tue: "terça-feira",
  wed: "quarta-feira",
  thu: "quinta-feira",
  fri: "sexta-feira",
  sat: "sábado",
  sun: "domingo",
};

const KEY_FROM_INDEX: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Hora 0-23 em timezone, robusto a DST. */
export function getHourMinutesInTimezone(now: Date, tz: string): { hour: number; minute: number } {
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(now),
    10,
  );
  const minute = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, minute: "2-digit" }).format(now),
    10,
  );
  return { hour, minute: isNaN(minute) ? 0 : minute };
}

/** Dia da semana (DayKey) em timezone. */
export function getDayKeyInTimezone(now: Date, tz: string): DayKey {
  const weekdayShort = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now).toLowerCase();
  const map: Record<string, DayKey> = {
    sun: "sun", mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat",
  };
  return map[weekdayShort] ?? "mon";
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

/**
 * Match janela contra (dayKey, minutesOfDay).
 * Trata wrap midnight (end <= start) consultando dia anterior também.
 */
export function windowMatches(window: BehaviorWindow, dayKey: DayKey, minutes: number): boolean {
  const startMin = parseHHMM(window.start);
  const endMin = parseHHMM(window.end);
  const days = Array.isArray(window.days) ? window.days : [];

  if (endMin > startMin) {
    if (!days.includes(dayKey)) return false;
    return minutes >= startMin && minutes <= endMin;
  }

  // Wrap midnight: cobre [start..1440) hoje + [0..end] amanhã.
  if (days.includes(dayKey) && minutes >= startMin) return true;

  const prevIdx = (WEEKDAY_INDEX[dayKey] + 6) % 7;
  const prevKey = KEY_FROM_INDEX[prevIdx];
  if (days.includes(prevKey) && minutes <= endMin) return true;

  return false;
}

export function formatNowText(now: Date, tz: string, dayKey: DayKey): string {
  const dateStr = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric",
  }).format(now);
  const timeStr = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);
  return `${DAY_LABEL[dayKey]}, ${dateStr} ${timeStr} (${tz})`;
}

/**
 * Formata um timestamp (ISO/timestamptz, armazenado em UTC) como DATA+HORA no
 * fuso do agente: "DD/MM/AAAA HH:MM". Vazio se nulo/inválido.
 *
 * O banco guarda tudo em UTC (timestamptz) — correto. O bug clássico é EXIBIR
 * cru (UTC) pro modelo: reunião às 14h (BRT) vira "17:00" no prompt e o copilot
 * comunica horário errado. Sempre converter na exibição.
 */
export function formatDateTimeInTz(
  iso: string | null | undefined,
  tz: string = DEFAULT_TIMEZONE,
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const date = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  return `${date} ${time}`;
}

/**
 * Formata um timestamp (ISO/timestamptz UTC) como DATA no fuso do agente:
 * "DD/MM/AAAA". Vazio se nulo/inválido. Usa o fuso pra não errar o dia perto
 * da meia-noite (toLocaleDateString sem timeZone usa o fuso do servidor = UTC).
 */
export function formatDateInTz(
  iso: string | null | undefined,
  tz: string = DEFAULT_TIMEZONE,
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric",
  }).format(d);
}

/**
 * Bloco de ancoragem temporal FORTE pro system prompt do copilot.
 *
 * Injeta HOJE e AMANHÃ já calculados (data + dia da semana, no fuso), pra o
 * modelo não precisar fazer aritmética de data nem cair na data do treino.
 *
 * RC 2026-06-24: copilot dizia "amanhã é quarta-feira, 26 de junho de 2024"
 * (ano do treino) mesmo com a linha "- Agora:" no prompt — só "hoje" exigia que
 * o modelo derivasse "amanhã"/weekday/ano sozinho, e modelo barato erra. Aqui
 * entregamos tudo mastigado + instrução dura contra datas de memória.
 *
 * Brasil sem horário de verão desde 2019 → +24h é seguro pra "amanhã"; ainda
 * assim o dayKey de amanhã é resolvido pelo fuso (robusto a qualquer mudança).
 */
export function formatTemporalAnchor(now: Date, tz: string): string {
  const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric",
    }).format(d);
  const timeStr = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);
  const year = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" }).format(now);

  const todayKey = getDayKeyInTimezone(now, tz);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowKey = getDayKeyInTimezone(tomorrow, tz);

  return [
    `- Agora: ${DAY_LABEL[todayKey]}, ${fmtDate(now)} ${timeStr} (${tz})`,
    `- Hoje é ${DAY_LABEL[todayKey]}, ${fmtDate(now)}. Amanhã é ${DAY_LABEL[tomorrowKey]}, ${fmtDate(tomorrow)}.`,
    `- O ano atual é ${year}. Use SOMENTE estas datas para qualquer referência temporal (hoje, amanhã, "semana que vem", "dia tal"). NUNCA invente uma data nem use data de memória/treino; calcule sempre a partir de HOJE acima.`,
  ].join("\n");
}

/**
 * Resolve janela ativa pra agente em momento `now`.
 *
 * @param agent objeto com behavior_windows + availability (pra timezone)
 * @param now Date corrente (default = new Date())
 * @returns contexto resolvido ou null se nenhuma janela casar
 */
export function resolveActiveWindow(
  agent: { behavior_windows?: unknown; availability?: { timezone?: string } | null },
  now: Date = new Date(),
): ResolvedTimeContext | null {
  const tz = agent?.availability?.timezone || DEFAULT_TIMEZONE;
  const windows = (Array.isArray(agent?.behavior_windows) ? agent.behavior_windows : []) as BehaviorWindow[];
  if (windows.length === 0) return null;

  const dayKey = getDayKeyInTimezone(now, tz);
  const { hour, minute } = getHourMinutesInTimezone(now, tz);
  const minutes = hour * 60 + minute;

  const match = windows.find((w) => w && Array.isArray(w.days) && windowMatches(w, dayKey, minutes));
  if (!match) return null;

  const nowText = formatNowText(now, tz, dayKey);
  const lines: string[] = [
    `- Agora: ${nowText}`,
    `- Janela ativa: "${match.name}"`,
  ];
  const trimmedBehavior = (match.behavior || "").trim();
  if (trimmedBehavior) {
    lines.push("- Comportamento esperado nesta janela:");
    lines.push(trimmedBehavior);
  } else {
    lines.push("- Sem instrução específica para esta janela (use o comportamento padrão do agente)");
  }

  return {
    window: match,
    formatted: lines.join("\n"),
    hasBehavior: trimmedBehavior.length > 0,
  };
}

/**
 * Constrói Date a partir de "YYYY-MM-DD" + "HH:MM" interpretado no timezone do agente.
 * Usado pra validar slot futuro de schedule_meeting.
 */
export function buildDateInTimezone(dateStr: string, timeStr: string, tz: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}/.test(timeStr)) return null;
  // Heurística: cria UTC, ajusta offset do tz no instante alvo.
  const naive = new Date(`${dateStr}T${timeStr}:00Z`);
  const offsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "shortOffset",
  }).formatToParts(naive);
  const offsetRaw = offsetParts.find((p) => p.type === "timeZoneName")?.value || "GMT+0";
  // offsetRaw exemplos: "GMT-3", "GMT+5:30"
  const m = offsetRaw.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return naive;
  const sign = m[1] === "+" ? 1 : -1;
  const hours = parseInt(m[2], 10);
  const minutes = parseInt(m[3] || "0", 10);
  const offsetMs = sign * (hours * 60 + minutes) * 60 * 1000;
  return new Date(naive.getTime() - offsetMs);
}

/**
 * Calcula próximo timestamp em que uma janela com `name` específico abre,
 * a partir de `from` no timezone fornecido. Usado pelo workflow-executor
 * pra suspender execução até janela X (action `hold_until:X`).
 *
 * Estratégia: avança minuto a minuto até 14 dias, primeiro match retorna.
 * Worst-case 14×24×60 = 20160 iterações — tolerável (sub-ms em V8).
 */
export function computeNextWindowStart(
  windows: BehaviorWindow[],
  targetName: string,
  tz: string,
  from: Date = new Date(),
): Date | null {
  const target = windows.find((w) => w?.name === targetName);
  if (!target) return null;

  for (let offset = 0; offset < 14 * 1440; offset++) {
    const probe = new Date(from.getTime() + offset * 60_000);
    const dayKey = getDayKeyInTimezone(probe, tz);
    const { hour, minute } = getHourMinutesInTimezone(probe, tz);
    if (windowMatches(target, dayKey, hour * 60 + minute)) {
      return probe;
    }
  }
  return null;
}

/**
 * Lookup do agente associado a uma conversation, retorna behavior_windows + availability.
 * Usado pelos tool handlers (schedule_meeting, transfer_to_human) pra ficar time-aware.
 */
export async function loadAgentTimeContext(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  conversationId: string,
): Promise<{
  behavior_windows: BehaviorWindow[] | null;
  behavior_enforcement: "hard" | "soft";
  availability: { timezone?: string } | null;
} | null> {
  try {
    const { data: conv } = await supabase
      .from("conversations")
      .select("agent_id")
      .eq("id", conversationId)
      .maybeSingle();
    const agentId = conv?.agent_id;
    if (!agentId) return null;

    const { data: agent } = await supabase
      .from("copilot_agents")
      .select("behavior_windows, behavior_enforcement, availability")
      .eq("id", agentId)
      .maybeSingle();
    if (!agent) return null;

    return {
      behavior_windows: (agent.behavior_windows as BehaviorWindow[] | null) ?? null,
      behavior_enforcement: ((agent.behavior_enforcement as "hard" | "soft") ?? "hard"),
      availability: (agent.availability as { timezone?: string } | null) ?? null,
    };
  } catch (e) {
    console.warn("[time-context] loadAgentTimeContext failed:", e);
    return null;
  }
}
