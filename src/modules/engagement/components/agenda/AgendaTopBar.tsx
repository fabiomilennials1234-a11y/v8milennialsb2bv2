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
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import type { EventTypeKey, ViewType } from "./agenda-helpers";
import { EVENT_TYPE_COLORS, EVENT_TYPE_LABELS } from "./agenda-helpers";
import { IconChip } from "@/components/ui/bento";

// ─── Types ────────────────────────────────────────────────────────────────────

// `ViewType` mudou de casa para `agenda-helpers` (a página consome o tipo sem
// consumir esta barra). Re-exportado para não quebrar quem importava daqui.
export type { ViewType };

interface TypeToggle {
  key: EventTypeKey;
  active: boolean;
}

interface AgendaTopBarProps {
  dateLabel: string;
  onNavigate: (dir: "prev" | "next" | "today") => void;
  typeToggles: TypeToggle[];
  onToggleType: (type: EventTypeKey) => void;
  isLoading: boolean;
  onRefresh: () => void;
  onNewEvent: () => void;
  googleConnected: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AgendaTopBar({
  dateLabel,
  onNavigate,
  typeToggles,
  onToggleType,
  isLoading,
  onRefresh,
  onNewEvent,
  googleConnected,
}: AgendaTopBarProps) {
  const activeCount = typeToggles.filter((t) => t.active).length;
  const allActive = activeCount === typeToggles.length;
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-card shrink-0 flex-wrap"
    >
      {/* Icon + Title — chip tintado do V5 (ouro de superfície, não de texto) */}
      <div className="flex items-center gap-2 mr-1">
        <IconChip icon={CalendarDays} tone="gold" />
        <span className="text-[15px] font-bold tracking-[-0.02em] text-foreground">Agenda</span>
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8 rounded-full"
          onClick={() => onNavigate("prev")}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3"
          onClick={() => onNavigate("today")}
        >
          Hoje
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8 rounded-full"
          onClick={() => onNavigate("next")}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Date label */}
      <span className="text-sm font-semibold text-foreground/80 capitalize flex-1 min-w-0 truncate">
        {dateLabel}
      </span>

      {/* Source filter */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-3"
          >
            <Filter className="w-3.5 h-3.5" />
            Filtrar
            {!allActive && (
              <span className="ml-0.5 rounded-full bg-primary-soft px-1.5 text-[10px] font-bold tabular-nums text-primary-soft-foreground">
                {activeCount}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-xs">Tipo</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {typeToggles.map((toggle) => (
            <DropdownMenuCheckboxItem
              key={toggle.key}
              checked={toggle.active}
              onCheckedChange={() => onToggleType(toggle.key)}
              onSelect={(e) => e.preventDefault()}
              className="gap-2 text-xs"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: EVENT_TYPE_COLORS[toggle.key] }}
              />
              {EVENT_TYPE_LABELS[toggle.key]}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Google Calendar status indicator */}
      {googleConnected && (
        <Badge
          variant="soft"
          className="text-[10px] h-5 px-2 gap-1 text-muted-foreground"
        >
          {/* Azul do Google: cor de marca de terceiro, não estado — fica literal. */}
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: "#4285F4" }}
          />
          Google
        </Badge>
      )}

      {/* Refresh */}
      <Button
        variant="ghost"
        size="icon"
        className="w-8 h-8"
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
        className="gap-1.5 h-8"
        onClick={onNewEvent}
      >
        <Plus className="w-3.5 h-3.5" />
        Novo Evento
      </Button>
    </motion.div>
  );
}
