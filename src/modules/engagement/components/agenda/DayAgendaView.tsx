/**
 * Day view layout: mini-month picker (left) + chronological event list (right).
 *
 * Replaces the vertical TimeGrid for the "day" view. Receives month-range
 * events so the mini-calendar can mark which days have appointments; the
 * right-hand list shows only the selected day's events, sorted by start time.
 */

import { useMemo } from "react";
import {
  format,
  isToday,
  isSameDay,
  isSameMonth,
  addMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion } from "framer-motion";
import { CalendarOff, ChevronLeft, ChevronRight } from "lucide-react";

import type { UnifiedEvent } from "./agenda-helpers";
import { SOURCE_LABELS, getMonthGrid } from "./agenda-helpers";

interface DayAgendaViewProps {
  /** Currently selected day (also drives which month the mini-calendar shows). */
  date: Date;
  /** Events spanning the visible month (used for dots + the day list). */
  events: UnifiedEvent[];
  /** Select a different day (mini-calendar cell or month nav). */
  onSelectDate: (day: Date) => void;
  /** Open the detail popover for an event. */
  onEventClick: (e: React.MouseEvent, event: UnifiedEvent) => void;
}

// Single-letter weekday headers (Sun→Sat), matching the compact mini-calendar.
const MINI_DAY_NAMES = ["D", "S", "T", "Q", "Q", "S", "S"];

// Literal mockup palette (kept verbatim so the day view matches the source mockup
// 1:1 instead of drifting through the app's semantic tokens).
const CREAM = "#f8f5e7";
const MUTE = "#8a857a";
const WARM = "#636156";
const ORANGE = "#ed9326";

// Frosted panel — exact rgba values from the mockup.
const PANEL_STYLE: React.CSSProperties = {
  background: "rgba(255,255,255,0.025)",
  border: "1px solid rgba(255,255,255,0.05)",
};

/** Build a per-event subtitle from the richest detail available. */
function eventSubtitle(event: UnifiedEvent): string {
  if (event.location) return event.location;
  const lead = [event.leadCompany, event.leadName].filter(Boolean).join(" · ");
  if (lead) return lead;
  return SOURCE_LABELS[event.source] ?? event.source;
}

export function DayAgendaView({
  date,
  events,
  onSelectDate,
  onEventClick,
}: DayAgendaViewProps) {
  const monthDays = useMemo(() => getMonthGrid(date), [date]);

  // Day-keys (yyyy-MM-dd) that have at least one event → drives the dots.
  const daysWithEvents = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) set.add(format(e.start, "yyyy-MM-dd"));
    return set;
  }, [events]);

  // Selected day's events, all-day first then chronological.
  const dayEvents = useMemo(() => {
    return events
      .filter((e) => isSameDay(e.start, date))
      .sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return a.start.getTime() - b.start.getTime();
      });
  }, [events, date]);

  const listHeader = isToday(date)
    ? `Hoje · ${format(date, "d 'de' MMMM", { locale: ptBR })}`
    : format(date, "EEEE, d 'de' MMMM", { locale: ptBR });

  return (
    <div className="flex-1 overflow-hidden px-5 py-4">
      <div className="grid h-full grid-cols-1 gap-3 lg:grid-cols-5">
        {/* ── Mini-calendar ──────────────────────────────────────────────── */}
        <div className="rounded-xl p-3.5 lg:col-span-2" style={PANEL_STYLE}>
          <div className="mb-3 flex items-center justify-between">
            <div
              className="font-display text-[12px] font-semibold capitalize"
              style={{ color: CREAM }}
            >
              {format(date, "MMMM yyyy", { locale: ptBR })}
            </div>
            <div className="flex items-center gap-0.5">
              <button
                aria-label="Mês anterior"
                className="flex h-5 w-5 items-center justify-center rounded text-[#8a857a] transition-colors hover:text-[#f8f5e7]"
                onClick={() => onSelectDate(addMonths(date, -1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                aria-label="Próximo mês"
                className="flex h-5 w-5 items-center justify-center rounded text-[#8a857a] transition-colors hover:text-[#f8f5e7]"
                onClick={() => onSelectDate(addMonths(date, 1))}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Weekday header */}
          <div
            className="mb-1.5 grid grid-cols-7 gap-1 text-center text-[9px]"
            style={{ color: MUTE }}
          >
            {MINI_DAY_NAMES.map((d, i) => (
              <div key={i}>{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
            {monthDays.map((day) => {
              const selected = isSameDay(day, date);
              const inMonth = isSameMonth(day, date);
              const hasEvents = daysWithEvents.has(format(day, "yyyy-MM-dd"));

              return (
                <button
                  key={day.toISOString()}
                  onClick={() => onSelectDate(day)}
                  className={`relative flex aspect-square items-center justify-center rounded-full transition-colors ${
                    selected ? "font-semibold" : "hover:bg-white/5"
                  }`}
                  style={
                    selected
                      ? {
                          color: "#1c1c1c",
                          background:
                            "linear-gradient(135deg, #ed9326, #ffd400)",
                          boxShadow: "0 0 12px rgba(237,147,38,0.4)",
                        }
                      : { color: inMonth ? CREAM : WARM }
                  }
                >
                  {format(day, "d")}
                  {hasEvents && !selected && (
                    <span
                      className="absolute bottom-1 h-1 w-1 rounded-full"
                      style={{ backgroundColor: ORANGE }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Day event list ─────────────────────────────────────────────── */}
        <div
          className="flex min-h-0 flex-col rounded-xl p-3.5 lg:col-span-3"
          style={PANEL_STYLE}
        >
          <div className="mb-3 flex items-baseline justify-between">
            <div
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{ color: MUTE }}
            >
              {listHeader}
            </div>
            {dayEvents.length > 0 && (
              <div className="text-[10px]" style={{ color: MUTE }}>
                {dayEvents.length}{" "}
                {dayEvents.length === 1 ? "compromisso" : "compromissos"}
              </div>
            )}
          </div>

          {dayEvents.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
              <CalendarOff className="h-6 w-6" style={{ color: WARM }} />
              <p className="text-xs" style={{ color: MUTE }}>
                Nenhum compromisso neste dia
              </p>
            </div>
          ) : (
            <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
              {dayEvents.map((event, i) => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15, delay: Math.min(i * 0.02, 0.2) }}
                  className="flex gap-3"
                >
                  <div
                    className="w-10 shrink-0 pt-0.5 text-[10px] tabular-nums"
                    style={{ color: MUTE }}
                  >
                    {event.allDay ? "Dia" : format(event.start, "HH:mm")}
                  </div>
                  <button
                    onClick={(e) => onEventClick(e, event)}
                    className="flex-1 rounded-xl border-l-2 py-2 pl-3 pr-2 text-left transition-all hover:brightness-110"
                    style={{
                      // color-mix tolerates any color format (hex, hsl, named),
                      // so the gold default (hsl) tints just like the hex sources.
                      backgroundColor: `color-mix(in srgb, ${event.color} 14%, transparent)`,
                      borderColor: event.color,
                    }}
                  >
                    <div
                      className="truncate text-[11px] font-medium"
                      style={{ color: CREAM }}
                    >
                      {event.title}
                    </div>
                    <div className="truncate text-[10px]" style={{ color: MUTE }}>
                      {eventSubtitle(event)}
                    </div>
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
