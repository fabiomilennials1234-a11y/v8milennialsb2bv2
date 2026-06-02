/**
 * agenda — Copilot v2 scheduling decision core (Slice 3, PURE).
 *
 * Sem I/O. (a) computeFreeSlots transforma os intervalos OCUPADOS (Google
 * freeBusy) + uma janela desejada em horários LIVRES (ISO determinístico) — os
 * mesmos que vão pra Introspection.slots, fechando o write-after-introspect de
 * agenda. (b) decideScheduleSlot decide, fail-CLOSED, se um datetime proposto é
 * agendável (deve estar nos livres, não no passado, ISO válido). O Google
 * Calendar I/O (token + fetch) vive no handler/worker.
 */

export interface BusyInterval { start: string; end: string; }
export interface TimeWindow { start: string; end: string; }

export interface FreeSlotsInput {
  busy: BusyInterval[];
  window: TimeWindow;
  /** Duração de cada slot proposto (default 60). */
  slotMinutes: number;
  now: Date;
}

const MS = 60_000;

/** ISO com offset preservado da janela (canônico p/ comparar com o datetime do LLM). */
function isoOf(d: Date, sample: string): string {
  // Preserva o offset textual da janela (ex.: -03:00) pra o slot bater 1:1 com
  // o que o LLM devolve. Sem isso, a comparação por string falharia entre Z e -03.
  const m = sample.match(/([+-]\d{2}:\d{2}|Z)$/);
  const offset = m ? m[1] : "Z";
  if (offset === "Z") return d.toISOString();
  const sign = offset[0] === "-" ? -1 : 1;
  const [oh, om] = offset.slice(1).split(":").map(Number);
  const shifted = new Date(d.getTime() + sign * (oh * 60 + om) * MS);
  return shifted.toISOString().replace("Z", offset);
}

export function computeFreeSlots(input: FreeSlotsInput): string[] {
  const winStart = new Date(input.window.start).getTime();
  const winEnd = new Date(input.window.end).getTime();
  if (isNaN(winStart) || isNaN(winEnd) || winEnd <= winStart) return [];

  const step = input.slotMinutes * MS;
  const busy = input.busy
    .map((b) => ({ s: new Date(b.start).getTime(), e: new Date(b.end).getTime() }))
    .filter((b) => !isNaN(b.s) && !isNaN(b.e));

  const free: string[] = [];
  for (let t = winStart; t + step <= winEnd; t += step) {
    if (t < input.now.getTime()) continue; // nunca propõe passado
    const slotEnd = t + step;
    const overlaps = busy.some((b) => t < b.e && slotEnd > b.s);
    if (!overlaps) free.push(isoOf(new Date(t), input.window.start));
  }
  return free;
}

export interface ScheduleSlotInput {
  datetime: string;
  freeSlots: string[];
  now: Date;
}

export type ScheduleDenyReason = "invalid_datetime" | "slot_in_past" | "slot_not_available";

export function decideScheduleSlot(
  input: ScheduleSlotInput,
): { ok: boolean; reason: ScheduleDenyReason | null } {
  const t = new Date(input.datetime).getTime();
  if (isNaN(t)) return { ok: false, reason: "invalid_datetime" };
  if (t < input.now.getTime()) return { ok: false, reason: "slot_in_past" };
  return input.freeSlots.includes(input.datetime)
    ? { ok: true, reason: null }
    : { ok: false, reason: "slot_not_available" };
}
