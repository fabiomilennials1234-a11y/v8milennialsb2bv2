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
import { CalendarOff, Check, ChevronLeft, ChevronRight, X } from "lucide-react";

import type { UnifiedEvent } from "./agenda-helpers";
import { SOURCE_LABELS, getMonthGrid, outcomeOf } from "./agenda-helpers";

interface DayAgendaViewProps {
  /** Currently selected day (also drives which month the mini-calendar shows). */
  date: Date;
  /** Events spanning the visible month (used for dots + the day list). */
  events: UnifiedEvent[];
  /** Select a different day (mini-calendar cell or month nav). */
  onSelectDate: (day: Date) => void;
  /** Open the detail popover for an event. */
  onEventClick: (e: React.MouseEvent, event: UnifiedEvent) => void;
  /**
   * Prefixa o subtítulo com o responsável. Ligado para quem enxerga a agenda
   * da equipe inteira — sem isso a lista vira uma pilha anônima de horários.
   */
  showOwner?: boolean;
}

// Single-letter weekday headers (Sun→Sat), matching the compact mini-calendar.
const MINI_DAY_NAMES = ["D", "S", "T", "Q", "Q", "S", "S"];

// V5: os dois blocos são cartões de bento. Antes eram um véu translúcido
// (`bg-foreground/[0.02]`) com o dia selecionado num gradiente LARANJA cru
// (`#ed9326 → #ffd400`) — fora da paleta, e o único laranja do produto. O dia
// escolhido agora é o ouro da marca em pastilha cheia (o mesmo "hoje" da grade
// do mês) e o ponto de "tem compromisso" é o ouro de TEXTO
// (`primary-soft-foreground`): o ouro cheio como ponto dá ~1,6:1 sobre o
// cartão claro e sumiria.
const PANEL_CLASS =
  "rounded-card border border-card-border bg-card shadow-relevo";

/** Build a per-event subtitle from the richest detail available. */
function eventSubtitle(event: UnifiedEvent, showOwner: boolean): string {
  const detalhe = (() => {
    if (event.location) return event.location;
    const lead = [event.leadCompany, event.leadName].filter(Boolean).join(" · ");
    if (lead) return lead;
    return SOURCE_LABELS[event.source] ?? event.source;
  })();

  if (showOwner && event.creatorName) return `${event.creatorName} · ${detalhe}`;
  return detalhe;
}

export function DayAgendaView({
  date,
  events,
  onSelectDate,
  onEventClick,
  showOwner = false,
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
    // Sem `px-5 py-4` próprio: a grade do mês encosta nas bordas do conteúdo,
    // e o dia precisa alinhar com ela em vez de recuar 20px.
    <div className="flex-1 overflow-hidden">
      <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-5">
        {/* ── Mini-calendar ──────────────────────────────────────────────── */}
        <div className={`p-4 lg:col-span-2 ${PANEL_CLASS}`}>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[15px] font-bold capitalize tracking-[-0.02em] text-foreground">
              {format(date, "MMMM yyyy", { locale: ptBR })}
            </div>
            <div className="flex items-center gap-0.5">
              <button
                aria-label="Mês anterior"
                className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => onSelectDate(addMonths(date, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                aria-label="Próximo mês"
                className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => onSelectDate(addMonths(date, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Weekday header */}
          <div className="mb-1.5 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-[.06em] text-muted-foreground">
            {MINI_DAY_NAMES.map((d, i) => (
              <div key={i}>{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] tabular-nums">
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
                      ? "bg-primary font-bold text-primary-foreground shadow-brilho-ouro"
                      : `hover:bg-muted ${
                          inMonth
                            ? "font-medium text-foreground"
                            : "text-muted-foreground/50"
                        }`
                  }`}
                >
                  {format(day, "d")}
                  {hasEvents && !selected && (
                    <span className="absolute bottom-1 h-1 w-1 rounded-full bg-primary-soft-foreground" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Day event list ─────────────────────────────────────────────── */}
        <div
          className={`flex min-h-0 flex-col p-4 lg:col-span-3 ${PANEL_CLASS}`}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="truncate text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
              {listHeader}
            </div>
            {dayEvents.length > 0 && (
              <div className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                {dayEvents.length}{" "}
                {dayEvents.length === 1 ? "compromisso" : "compromissos"}
              </div>
            )}
          </div>

          {dayEvents.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
                <CalendarOff className="h-5 w-5" />
              </span>
              <p className="text-sm font-semibold text-foreground">
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
                  <div className="w-10 shrink-0 pt-2 text-[11px] font-semibold tabular-nums text-muted-foreground">
                    {event.allDay ? "Dia" : format(event.start, "HH:mm")}
                  </div>
                  <button
                    onClick={(e) => onEventClick(e, event)}
                    className="min-w-0 flex-1 rounded-xl border-l-[3px] py-2 pl-3 pr-2 text-left transition-all hover:brightness-110"
                    style={{
                      // color-mix tolerates any color format (hex, hsl, named),
                      // so the gold default (hsl) tints just like the hex sources.
                      backgroundColor: `color-mix(in srgb, ${event.color} 14%, transparent)`,
                      borderColor: event.color,
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      {/* Mesmo sinal da grade do mês: ícone + rótulo lido por
                          leitor de tela, nunca só a cor. */}
                      {/* Par de escala `x dark:y` de propósito — ver
                          `AgendaOutcomeToggle` (token de preenchimento não
                          chega a 3:1 como ícone sobre o banho, tema claro). */}
                      {outcomeOf(event) === "compareceu" && (
                        <Check
                          className="h-3 w-3 shrink-0 text-emerald-700 dark:text-emerald-300"
                          strokeWidth={3}
                          aria-label="Compareceu"
                        />
                      )}
                      {outcomeOf(event) === "nao_compareceu" && (
                        <X
                          className="h-3 w-3 shrink-0 text-red-700 dark:text-red-300"
                          strokeWidth={3}
                          aria-label="Não compareceu"
                        />
                      )}
                      <div className="min-w-0 truncate text-[13px] font-semibold text-foreground">
                        {event.title}
                      </div>
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {eventSubtitle(event, showOwner)}
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
