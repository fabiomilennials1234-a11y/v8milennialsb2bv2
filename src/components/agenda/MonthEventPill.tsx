/**
 * Compact event pill rendered inside month grid cells.
 */

import { format } from "date-fns";
import type { UnifiedEvent } from "./agenda-helpers";

interface MonthEventPillProps {
  event: UnifiedEvent;
  onClick: (e: React.MouseEvent, event: UnifiedEvent) => void;
}

export function MonthEventPill({ event, onClick }: MonthEventPillProps) {
  const color = event.color;
  return (
    <button
      className="w-full text-left px-1.5 py-px rounded text-[10px] truncate leading-snug transition-all hover:brightness-110"
      style={{
        borderLeft: `2px solid ${color}`,
        backgroundColor: `${color}18`,
        color,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e, event);
      }}
    >
      {event.allDay ? "dia todo" : format(event.start, "HH:mm")} {event.title}
    </button>
  );
}
