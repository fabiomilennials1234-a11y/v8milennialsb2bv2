/**
 * Month grid view showing event pills per day cell.
 *
 * Extracted from the original Agenda.tsx monolith.
 */

import { format, isToday, isSameDay } from "date-fns";
import type { UnifiedEvent } from "./agenda-helpers";
import { DAY_NAMES_SHORT, getMonthGrid } from "./agenda-helpers";
import { MonthEventPill } from "./MonthEventPill";

interface MonthViewProps {
  date: Date;
  events: UnifiedEvent[];
  onEventClick: (e: React.MouseEvent, event: UnifiedEvent) => void;
  onSlotClick: (day: Date) => void;
}

export function MonthView({
  date,
  events,
  onEventClick,
  onSlotClick,
}: MonthViewProps) {
  const days = getMonthGrid(date);
  const currentMonth = date.getMonth();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Day names header */}
      <div className="grid grid-cols-7 border-b border-border/30 bg-card/30 shrink-0">
        {DAY_NAMES_SHORT.map((name) => (
          <div
            key={name}
            className="py-2.5 text-center text-[10px] uppercase tracking-widest text-muted-foreground/50 font-medium"
          >
            {name}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div
        className="flex-1 overflow-auto"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridTemplateRows: "repeat(6, 1fr)",
        }}
      >
        {days.map((day) => {
          const isCurrentMonth = day.getMonth() === currentMonth;
          const today = isToday(day);
          const dayEvents = events.filter((e) => isSameDay(e.start, day));

          return (
            <div
              key={day.toISOString()}
              className={`border-b border-r border-border/15 p-1.5 overflow-hidden cursor-pointer transition-colors hover:bg-muted/20 min-h-[90px] ${
                !isCurrentMonth ? "opacity-30" : ""
              } ${today ? "bg-primary/[0.03]" : ""}`}
              onClick={() => onSlotClick(day)}
            >
              <div className="flex items-center justify-center mb-1">
                <span
                  className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${
                    today
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground/60"
                  }`}
                >
                  {format(day, "d")}
                </span>
              </div>
              <div className="space-y-px">
                {dayEvents.slice(0, 3).map((event) => (
                  <MonthEventPill
                    key={event.id}
                    event={event}
                    onClick={onEventClick}
                  />
                ))}
                {dayEvents.length > 3 && (
                  <p className="text-[10px] text-muted-foreground/60 pl-1 pt-px">
                    +{dayEvents.length - 3} mais
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
