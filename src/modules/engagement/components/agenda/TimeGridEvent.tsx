/**
 * Single event card rendered inside the TimeGrid day columns.
 *
 * Positioned absolutely based on start time / duration and
 * overlap layout fractions provided by the parent.
 */

import { format } from "date-fns";
import type { UnifiedEvent } from "./agenda-helpers";
import { getEventTop, getEventHeight, SOURCE_LABELS } from "./agenda-helpers";

interface TimeGridEventProps {
  event: UnifiedEvent;
  dayStart: Date;
  /** Left offset as a fraction of column width (0-1). */
  leftPct: number;
  /** Width as a fraction of column width (0-1). */
  widthPct: number;
  onClick: (e: React.MouseEvent, event: UnifiedEvent) => void;
}

export function TimeGridEvent({
  event,
  dayStart,
  leftPct,
  widthPct,
  onClick,
}: TimeGridEventProps) {
  const top = getEventTop(event, dayStart);
  const height = Math.max(getEventHeight(event), 22);
  const color = event.color;
  const MARGIN = 2;

  return (
    <div
      className="absolute rounded-r-lg cursor-pointer overflow-hidden transition-all duration-150 hover:brightness-110 hover:shadow-relevo z-10"
      style={{
        top: `${top}px`,
        height: `${height}px`,
        left: `calc(${leftPct * 100}% + ${MARGIN}px)`,
        width: `calc(${widthPct * 100}% - ${MARGIN * 2}px)`,
        borderLeft: `3px solid ${color}`,
        // `color-mix`, e não o sufixo de alfa `${cor}1A`: três das cinco
        // fontes são `hsl(...)`, e `"hsl(47, 100%, 50%)1A"` é declaração
        // inválida, descartada em silêncio — mesmo conserto do popover.
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
      onClick={(e) => onClick(e, event)}
    >
      <div className="px-2 py-0.5 h-full flex flex-col justify-start overflow-hidden">
        {/* A cor da fonte fica na borda e no banho, nunca no texto — mesmo
            idioma de `MonthEventPill`: o ouro como texto dá ~1,7:1. */}
        <p className="text-[11px] font-semibold leading-tight truncate text-foreground">
          {event.title}
        </p>
        {height > 38 && (
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
            {format(event.start, "HH:mm")} - {format(event.end, "HH:mm")}
          </p>
        )}
        {height > 54 && (
          <p className="text-[9px] text-muted-foreground/60 leading-tight mt-0.5 truncate">
            {SOURCE_LABELS[event.source] ?? event.source}
          </p>
        )}
      </div>
    </div>
  );
}
