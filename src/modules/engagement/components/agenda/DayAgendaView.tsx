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

// Accent used for the "has events" dot — reads on both light and dark backgrounds.
const ORANGE = "#ed9326";

// Frosted panel — theme-aware so it tints with the background instead of using a
// fixed white wash (which vanished against the light theme's cream background).
// `foreground/[0.02]` resolves to a faint light wash in dark mode and a faint dark
// wash in light mode, matching the original mockup look in both.
const PANEL_CLASS = "bg-foreground/[0.02] border border-border/50";

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
        <div className={`rounded-xl p-3.5 lg:col-span-2 ${PANEL_CLASS}`}>
          <div className="mb-3 flex items-center justify-between">
            <div className="font-display text-[12px] font-semibold capitalize text-foreground">
              {format(date, "MMMM yyyy", { locale: ptBR })}
            </div>
            <div className="flex items-center gap-0.5">
              <button
                aria-label="Mês anterior"
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => onSelectDate(addMonths(date, -1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                aria-label="Próximo mês"
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => onSelectDate(addMonths(date, 1))}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Weekday header */}
          <div className="mb-1.5 grid grid-cols-7 gap-1 text-center text-[9px] text-muted-foreground">
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
                    selected
                      ? "font-semibold"
                      : `hover:bg-foreground/5 ${
                          inMonth ? "text-foreground" : "text-muted-foreground/40"
                        }`
                  }`}
                  style={
                    selected
                      ? {
                          color: "#1c1c1c",
                          background:
                            "linear-gradient(135deg, #ed9326, #ffd400)",
                          boxShadow: "0 0 12px rgba(237,147,38,0.4)",
                        }
                      : undefined
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
          className={`flex min-h-0 flex-col rounded-xl p-3.5 lg:col-span-3 ${PANEL_CLASS}`}
        >
          <div className="mb-3 flex items-baseline justify-between">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {listHeader}
            </div>
            {dayEvents.length > 0 && (
              <div className="text-[10px] text-muted-foreground">
                {dayEvents.length}{" "}
                {dayEvents.length === 1 ? "compromisso" : "compromissos"}
              </div>
            )}
          </div>

          {dayEvents.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
              <CalendarOff className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">
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
                  <div className="w-10 shrink-0 pt-0.5 text-[10px] tabular-nums text-muted-foreground">
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
                    <div className="truncate text-[11px] font-medium text-foreground">
                      {event.title}
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
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
