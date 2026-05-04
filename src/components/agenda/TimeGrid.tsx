/**
 * Day / Week time grid with hour rows, half-hour lines,
 * overlapping event cards, and current-time indicator.
 *
 * Extracted from the original Agenda.tsx monolith.
 */

import { useState, useRef, useEffect } from "react";
import { format, isToday, isSameDay, startOfDay } from "date-fns";
import type { UnifiedEvent } from "./agenda-helpers";
import {
  HOUR_HEIGHT,
  HOURS,
  DAY_NAMES_SHORT,
  getNowTop,
  computeEventLayout,
} from "./agenda-helpers";
import { TimeGridEvent } from "./TimeGridEvent";

interface TimeGridProps {
  days: Date[];
  events: UnifiedEvent[];
  onEventClick: (e: React.MouseEvent, event: UnifiedEvent) => void;
  onSlotClick: (day: Date, hour: number) => void;
}

export function TimeGrid({
  days,
  events,
  onEventClick,
  onSlotClick,
}: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowTop, setNowTop] = useState(getNowTop());

  // Scroll to current time on mount / view switch
  useEffect(() => {
    if (scrollRef.current) {
      const target = Math.max(0, (new Date().getHours() - 2) * HOUR_HEIGHT);
      scrollRef.current.scrollTop = target;
    }
  }, [days.length]);

  // Update time indicator every minute
  useEffect(() => {
    const interval = setInterval(() => setNowTop(getNowTop()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const totalHeight = HOUR_HEIGHT * 24;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Day headers */}
      <div
        className="flex border-b border-border/30 shrink-0 bg-card/30"
        style={{ paddingLeft: "52px" }}
      >
        {days.map((day) => {
          const today = isToday(day);
          return (
            <div
              key={day.toISOString()}
              className="flex-1 py-3 flex flex-col items-center gap-0.5"
            >
              <span
                className={`text-[10px] uppercase tracking-widest font-medium ${
                  today ? "text-primary" : "text-muted-foreground/50"
                }`}
              >
                {DAY_NAMES_SHORT[day.getDay()]}
              </span>
              <span
                className={`text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
                  today
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground/80 hover:bg-muted"
                }`}
              >
                {format(day, "d")}
              </span>
            </div>
          );
        })}
      </div>

      {/* Scrollable grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex relative" style={{ height: `${totalHeight}px` }}>
          {/* Hour labels */}
          <div className="w-[52px] shrink-0 relative select-none">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute w-full flex items-start justify-end pr-2.5"
                style={{
                  top: `${hour * HOUR_HEIGHT}px`,
                  height: `${HOUR_HEIGHT}px`,
                }}
              >
                {hour > 0 && (
                  <span className="text-[10px] text-muted-foreground/40 leading-none -mt-2">
                    {String(hour).padStart(2, "0")}:00
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const dayStart = startOfDay(day);
            const dayEvents = events.filter((e) => isSameDay(e.start, day));
            const isCurrentDay = isToday(day);
            const layout = computeEventLayout(dayEvents);

            return (
              <div
                key={day.toISOString()}
                className={`flex-1 relative border-l border-border/20 ${
                  isCurrentDay ? "bg-primary/[0.015]" : ""
                }`}
              >
                {/* Hour rows */}
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="absolute w-full border-t border-border/15 cursor-pointer hover:bg-muted/20 transition-colors"
                    style={{
                      top: `${hour * HOUR_HEIGHT}px`,
                      height: `${HOUR_HEIGHT}px`,
                    }}
                    onClick={() => onSlotClick(day, hour)}
                  />
                ))}

                {/* Half-hour lines */}
                {HOURS.map((hour) => (
                  <div
                    key={`h-${hour}`}
                    className="absolute w-full border-t border-border/8 pointer-events-none"
                    style={{
                      top: `${hour * HOUR_HEIGHT + HOUR_HEIGHT / 2}px`,
                    }}
                  />
                ))}

                {/* Events */}
                {dayEvents.map((event) => {
                  const pos = layout.get(event.id) ?? { left: 0, width: 1 };
                  return (
                    <TimeGridEvent
                      key={event.id}
                      event={event}
                      dayStart={dayStart}
                      leftPct={pos.left}
                      widthPct={pos.width}
                      onClick={onEventClick}
                    />
                  );
                })}

                {/* Current time indicator */}
                {isCurrentDay && (
                  <div
                    className="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
                    style={{ top: `${nowTop}px` }}
                  >
                    <div className="w-2 h-2 rounded-full bg-primary shrink-0 -ml-1 shadow-sm" />
                    <div className="flex-1 h-px bg-primary/50" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
