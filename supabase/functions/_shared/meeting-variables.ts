/**
 * Variáveis de reunião para mensagens de automação: `{{dia_reuniao}}`,
 * `{{hora_reuniao}}` e o fallback canônico de `{{data_reuniao}}`.
 *
 * Fonte: `meetings` (a agenda canônica — toda reunião datada de funil é uma linha
 * ali desde `20271021000005_canonical_pipeline_meetings`). O `{{data_reuniao}}`
 * legado lia `pipeline_entries.metadata.meeting_date` do funil `confirmacao`
 * CHUMBADO: em qualquer outro funil saía vazio, e nunca trazia a hora.
 *
 * Escolha da reunião, nesta ordem:
 *   1. a próxima reunião AGENDADA do negócio que disparou (`pipeline_entry_id`);
 *   2. sem ela, a próxima reunião agendada do lead na organização.
 * "Próxima" = `status = 'scheduled'`, `event_type = 'meeting'`, `start_at >= agora`.
 * Cancelada, no-show e concluída nunca entram — a mensagem não pode confirmar
 * um horário que não vai acontecer.
 *
 * Formato pensado para soar digitado à mão ("pra sexta às 15h"):
 *   dia  → "hoje" | "amanhã" | "quinta" (até 6 dias) | "quinta, 10/12" (7+ dias)
 *   hora → "15h" | "15h30" | "9h"
 * Tudo em America/Sao_Paulo. Sem reunião, as variáveis saem VAZIAS (nunca o
 * placeholder cru) — quem precisa barrar o envio usa a condição
 * `days_until_meeting`, que fica ausente quando não há reunião.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const TZ = "America/Sao_Paulo";
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export const MEETING_TEMPLATE_KEYS = ["dia_reuniao", "hora_reuniao", "data_reuniao"] as const;
export type MeetingTemplateVars = Record<(typeof MEETING_TEMPLATE_KEYS)[number], string>;

export interface MeetingLookup {
  leadId: string;
  organizationId: string;
  /** `pipeline_entries.id` do negócio da execução, quando conhecido. */
  entryId: string | null;
}

export interface NextMeeting {
  id: string;
  start_at: string;
}

/** Partes de calendário (ano/mês/dia/hora/minuto/dia da semana) no fuso de SP. */
function partsInTz(d: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekdayIdx,
  };
}

/** Dias de CALENDÁRIO (em SP) entre hoje e a data da reunião. Hoje = 0. */
export function calendarDaysUntil(start: Date, now: Date = new Date()): number {
  const a = partsInTz(now);
  const b = partsInTz(start);
  const dayA = Date.UTC(a.year, a.month - 1, a.day);
  const dayB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((dayB - dayA) / 86_400_000);
}

export function formatMeetingHour(start: Date): string {
  const { hour, minute } = partsInTz(start);
  return minute === 0 ? `${hour}h` : `${hour}h${String(minute).padStart(2, "0")}`;
}

export function formatMeetingDay(start: Date, now: Date = new Date()): string {
  const days = calendarDaysUntil(start, now);
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  const { weekdayIdx, day, month } = partsInTz(start);
  const name = WEEKDAYS[weekdayIdx] ?? "";
  if (days > 1 && days < 7) return name;
  return `${name}, ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}

function formatMeetingDate(start: Date): string {
  const { day, month, year } = partsInTz(start);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

/**
 * Próxima reunião agendada — do negócio da execução, senão do lead.
 * Erro de leitura vira `null`: variável vazia é recuperável, execução derrubada
 * por uma consulta auxiliar não é.
 */
export async function findNextMeeting(
  supabase: SupabaseClient,
  { leadId, organizationId, entryId }: MeetingLookup,
  now: Date = new Date(),
): Promise<NextMeeting | null> {
  if (!leadId || !organizationId) return null;

  const { data, error } = await supabase
    .from("meetings")
    .select("id, start_at, pipeline_entry_id")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .eq("event_type", "meeting")
    .eq("status", "scheduled")
    .gte("start_at", now.toISOString())
    .order("start_at", { ascending: true })
    .limit(20);

  if (error || !data || data.length === 0) return null;

  const rows = data as Array<{ id: string; start_at: string; pipeline_entry_id: string | null }>;
  const chosen = (entryId ? rows.find((r) => r.pipeline_entry_id === entryId) : undefined) ?? rows[0];
  return { id: chosen.id, start_at: chosen.start_at };
}

/** O template usa alguma variável de reunião? Evita a consulta quando não usa. */
export function templateUsesMeeting(template: string): boolean {
  return MEETING_TEMPLATE_KEYS.some((k) => template.includes(`{{${k}}}`));
}

/**
 * Valores para as variáveis de reunião usadas no template. `{}` quando o template
 * não usa nenhuma (e então nada é consultado).
 */
export async function meetingTemplateVariables(
  supabase: SupabaseClient,
  template: string,
  lookup: MeetingLookup,
  now: Date = new Date(),
): Promise<Partial<MeetingTemplateVars>> {
  if (!templateUsesMeeting(template)) return {};
  const meeting = await findNextMeeting(supabase, lookup, now);
  if (!meeting) return { dia_reuniao: "", hora_reuniao: "", data_reuniao: "" };
  const start = new Date(meeting.start_at);
  return {
    dia_reuniao: formatMeetingDay(start, now),
    hora_reuniao: formatMeetingHour(start),
    data_reuniao: formatMeetingDate(start),
  };
}

/**
 * Para a condição `days_until_meeting`: dias de calendário até a próxima reunião,
 * ou `undefined` quando não há. `undefined` (não `null`, não 0) faz toda
 * comparação numérica reprovar — "sem reunião" não pode passar em "menor que 3".
 */
export async function daysUntilNextMeeting(
  supabase: SupabaseClient,
  lookup: MeetingLookup,
  now: Date = new Date(),
): Promise<number | undefined> {
  const meeting = await findNextMeeting(supabase, lookup, now);
  return meeting ? calendarDaysUntil(new Date(meeting.start_at), now) : undefined;
}
