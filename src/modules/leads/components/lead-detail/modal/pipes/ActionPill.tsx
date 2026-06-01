import { memo } from "react";
import { Calendar, ChevronDown, DollarSign } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

/**
 * ActionPill — compact, always-visible chip that summarizes the
 * Meeting/Reunião (confirmação) or Budget/Orçamento (propostas) pipe and
 * toggles the expanded ActionPanel below the StageRails.
 *
 * Closed state shows a formatted value (date for meeting, currency for
 * budget). Open state lifts the chip with a subtle primary tint.
 */

export type ActionPillType = "meeting" | "budget";

interface ActionPillProps {
  type: ActionPillType;
  /** When meeting: ISO date or null. When budget: numeric value or null. */
  value: string | number | null;
  isOpen: boolean;
  onToggle: () => void;
}

const meetingValue = (raw: string | number | null): { label: string; muted: boolean } => {
  if (!raw) return { label: "Sem data", muted: true };
  const dt = new Date(String(raw));
  if (Number.isNaN(dt.getTime())) return { label: "Sem data", muted: true };
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round(
    (startOfDay(dt).getTime() - startOfDay(now).getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0) return { label: `Hoje · ${format(dt, "HH'h'mm", { locale: ptBR })}`, muted: false };
  if (diffDays === 1) return { label: `Amanhã · ${format(dt, "HH'h'mm", { locale: ptBR })}`, muted: false };
  return { label: format(dt, "dd/MM '·' HH'h'mm", { locale: ptBR }), muted: false };
};

const budgetValue = (raw: string | number | null): { label: string; muted: boolean } => {
  const n = typeof raw === "string" ? Number(raw) : raw ?? 0;
  if (!n || Number.isNaN(n)) return { label: "a definir", muted: true };
  return {
    label: new Intl.NumberFormat("pt-BR", {
      notation: "compact",
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 1,
    }).format(n),
    muted: false,
  };
};

/** Returns urgency dot info for meeting, or null if more than 2 days out. */
const meetingUrgency = (raw: string | number | null): { className: string; label: string } | null => {
  if (!raw) return null;
  const dt = new Date(String(raw));
  if (Number.isNaN(dt.getTime())) return null;
  const now = new Date();
  const diffMs = dt.getTime() - now.getTime();
  const dayMs = 1000 * 60 * 60 * 24;
  if (diffMs < -dayMs)
    return {
      className: "bg-destructive shadow-[0_0_0_3px_hsl(var(--destructive)/0.2)] motion-safe:animate-pulse",
      label: "Atrasada",
    };
  if (diffMs < 0)
    return {
      className: "bg-destructive shadow-[0_0_0_3px_hsl(var(--destructive)/0.2)] motion-safe:animate-pulse",
      label: "Atrasada",
    };
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round(
    (startOfDay(dt).getTime() - startOfDay(now).getTime()) / dayMs,
  );
  if (diffDays === 0)
    return {
      className: "bg-amber-500 shadow-[0_0_0_3px_hsl(38_92%_50%/0.2)]",
      label: "Hoje",
    };
  if (diffDays === 1) return { className: "bg-yellow-500", label: "Amanhã" };
  return null;
};

export const ActionPill = memo(function ActionPill({
  type,
  value,
  isOpen,
  onToggle,
}: ActionPillProps) {
  const isMeeting = type === "meeting";
  const formatted = isMeeting ? meetingValue(value) : budgetValue(value);
  const urgency = isMeeting ? meetingUrgency(value) : null;
  const Icon = isMeeting ? Calendar : DollarSign;
  const labelTop = isMeeting ? "Reunião" : "Orçamento";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      data-testid={`action-pill-${type}`}
      className={cn(
        "group relative flex items-center gap-2.5 h-9 pl-3 pr-3.5 rounded-full",
        "border bg-card transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isOpen
          ? "border-primary/40 bg-primary/[0.06] shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.2)]"
          : "border-border/60 hover:border-border hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center w-5 h-5 rounded-full transition-colors",
          isOpen ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
        )}
      >
        <Icon className="w-3.5 h-3.5" aria-hidden />
      </span>
      <span className="flex flex-col items-start leading-tight min-w-0">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
          {labelTop}
        </span>
        <span
          className={cn(
            "text-xs font-semibold tabular-nums truncate",
            formatted.muted ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {formatted.label}
        </span>
      </span>
      {urgency && (
        <span
          className={cn("w-1.5 h-1.5 rounded-full shrink-0", urgency.className)}
          aria-label={urgency.label}
        />
      )}
      <ChevronDown
        className={cn(
          "w-3.5 h-3.5 text-muted-foreground/60 shrink-0 transition-transform duration-200",
          isOpen && "rotate-180 text-primary/70",
        )}
        aria-hidden
      />
    </button>
  );
});
