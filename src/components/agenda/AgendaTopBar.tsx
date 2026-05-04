/**
 * Top bar for the Agenda page.
 *
 * Horizontal bar with:
 * - Navigation (prev / today / next)
 * - Date label
 * - Source filter toggles (meetings, follow-ups, scheduled msgs, confirmacao, Google)
 * - View switcher (day / week / month)
 * - Refresh button
 * - "Novo Evento" button
 */

import { motion } from "framer-motion";
import {
  CalendarDays,
  Plus,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { EventSource } from "./agenda-helpers";
import { SOURCE_COLORS, SOURCE_LABELS } from "./agenda-helpers";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ViewType = "day" | "week" | "month";

interface SourceToggle {
  key: EventSource;
  active: boolean;
}

interface AgendaTopBarProps {
  dateLabel: string;
  view: ViewType;
  onViewChange: (view: ViewType) => void;
  onNavigate: (dir: "prev" | "next" | "today") => void;
  sourceToggles: SourceToggle[];
  onToggleSource: (source: EventSource) => void;
  isLoading: boolean;
  onRefresh: () => void;
  onNewEvent: () => void;
  googleConnected: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AgendaTopBar({
  dateLabel,
  view,
  onViewChange,
  onNavigate,
  sourceToggles,
  onToggleSource,
  isLoading,
  onRefresh,
  onNewEvent,
  googleConnected,
}: AgendaTopBarProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2 px-4 py-2.5 border-b border-border/30 bg-card/40 backdrop-blur-sm shrink-0 flex-wrap"
    >
      {/* Icon + Title */}
      <div className="flex items-center gap-2 mr-1">
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
          <CalendarDays className="w-3.5 h-3.5 text-primary" />
        </div>
        <span className="font-semibold text-sm text-foreground/90">Agenda</span>
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="w-7 h-7 rounded-lg"
          onClick={() => onNavigate("prev")}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2.5 text-xs rounded-lg font-medium"
          onClick={() => onNavigate("today")}
        >
          Hoje
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="w-7 h-7 rounded-lg"
          onClick={() => onNavigate("next")}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Date label */}
      <span className="text-sm font-medium text-foreground/70 capitalize flex-1 min-w-0 truncate">
        {dateLabel}
      </span>

      {/* Source toggles */}
      <div className="flex items-center gap-3">
        {sourceToggles.map((toggle) => (
          <button
            key={toggle.key}
            onClick={() => onToggleSource(toggle.key)}
            className="flex items-center gap-1.5 text-xs transition-all duration-150"
            style={{ opacity: toggle.active ? 1 : 0.35 }}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: SOURCE_COLORS[toggle.key] }}
            />
            <span className="text-muted-foreground text-[11px]">
              {SOURCE_LABELS[toggle.key]}
            </span>
          </button>
        ))}
      </div>

      {/* Google Calendar status indicator */}
      {googleConnected && (
        <Badge
          variant="outline"
          className="text-[9px] h-4 px-1.5 gap-1 text-muted-foreground/60 border-border/30"
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: SOURCE_COLORS.google }}
          />
          Google
        </Badge>
      )}

      {/* View switcher */}
      <div className="flex items-center bg-muted/60 rounded-lg p-0.5 gap-px">
        {(["day", "week", "month"] as ViewType[]).map((v) => (
          <button
            key={v}
            onClick={() => onViewChange(v)}
            className={`px-2.5 py-1 text-[11px] rounded-md transition-all font-medium ${
              view === v
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground/80"
            }`}
          >
            {v === "day" ? "Dia" : v === "week" ? "Semana" : "Mes"}
          </button>
        ))}
      </div>

      {/* Refresh */}
      <Button
        variant="ghost"
        size="icon"
        className="w-7 h-7 rounded-lg"
        onClick={onRefresh}
        disabled={isLoading}
        title="Atualizar"
      >
        <RefreshCw
          className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
        />
      </Button>

      {/* New Event */}
      <Button
        size="sm"
        className="gap-1.5 h-7 text-xs rounded-lg"
        onClick={onNewEvent}
      >
        <Plus className="w-3.5 h-3.5" />
        Novo Evento
      </Button>
    </motion.div>
  );
}
