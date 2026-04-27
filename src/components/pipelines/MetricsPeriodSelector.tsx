import { useCallback, useMemo, useRef, useState } from "react";
import { format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange as RDPDateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { type MetricsPeriod, type MetricsPeriodState, getWeekRange } from "@/lib/metrics-period";

interface MetricsPeriodSelectorProps {
  state: MetricsPeriodState;
  onChange: (state: MetricsPeriodState) => void;
}

export function MetricsPeriodSelector({ state, onChange }: MetricsPeriodSelectorProps) {
  const { period, month, year, customRange, weekDate } = state;
  const now = useRef(new Date()).current;

  const setPeriod = useCallback((p: MetricsPeriod) => {
    onChange({ ...state, period: p });
  }, [state, onChange]);

  const setMonth = useCallback((m: number) => {
    onChange({ ...state, month: m });
  }, [state, onChange]);

  const setYear = useCallback((y: number) => {
    onChange({ ...state, year: y });
  }, [state, onChange]);

  // --- Custom range: aceita estado intermediário (só from, sem to) ---
  const handleCustomRangeSelect = useCallback((range: RDPDateRange | undefined) => {
    if (!range) {
      onChange({ ...state, customRange: null });
      return;
    }
    // Salva o estado mesmo que `to` seja undefined (primeiro clique)
    onChange({
      ...state,
      customRange: range.from ? { from: range.from, to: range.to } : null,
    });
  }, [state, onChange]);

  // --- Week: clique em qualquer dia → seleciona seg–sex daquela semana ---
  const handleWeekDayClick = useCallback((day: Date) => {
    onChange({ ...state, weekDate: day });
  }, [state, onChange]);

  // --- Week hover: preview the week row on mouse over ---
  const [hoveredWeek, setHoveredWeek] = useState<{ from: Date; to: Date } | null>(null);

  const handleWeekDayHover = useCallback((day: Date) => {
    setHoveredWeek(getWeekRange(day));
  }, []);

  const weekRange = getWeekRange(weekDate ?? now);
  const summaryText = getSummaryText(state, now);

  // Build modifiers for the week calendar hover preview
  const weekModifiers = useMemo(() => {
    if (!hoveredWeek) return {};
    const days: Date[] = [];
    const d = new Date(hoveredWeek.from);
    while (d <= hoveredWeek.to) {
      days.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return { weekHover: days };
  }, [hoveredWeek]);

  const weekModifiersStyles = useMemo(() => ({
    weekHover: {
      backgroundColor: "hsl(var(--primary) / 0.08)",
      borderRadius: 0,
    } as React.CSSProperties,
  }), []);

  /** Shared trigger button classes — visually cohesive with TabsList */
  const triggerBtnClass = cn(
    "h-9 gap-2 text-xs font-medium",
    "border-border/50 bg-secondary/30 text-muted-foreground",
    "hover:bg-secondary/60 hover:text-foreground hover:border-border",
    "transition-colors",
  );

  /** Shared popover content classes */
  const popoverClass = "w-auto p-0 border-border/60 shadow-lg dark:shadow-black/40 dark:bg-popover";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Tabs value={period} onValueChange={(v) => setPeriod(v as MetricsPeriod)}>
        <TabsList className="h-9">
          <TabsTrigger value="all" className="gap-1.5 text-xs">Geral</TabsTrigger>
          <TabsTrigger value="month" className="gap-1.5 text-xs">Por mês</TabsTrigger>
          <TabsTrigger value="week" className="gap-1.5 text-xs">Por semana</TabsTrigger>
          <TabsTrigger value="custom" className="gap-1.5 text-xs">Personalizado</TabsTrigger>
        </TabsList>
      </Tabs>

      {period === "month" && (
        <>
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-[140px] h-9 border-border/50 bg-secondary/30">
              <CalendarIcon className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {format(new Date(year, m - 1), "MMMM", { locale: ptBR })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-[100px] h-9 border-border/50 bg-secondary/30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[year - 2, year - 1, year, year + 1].map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}

      {period === "week" && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={triggerBtnClass}>
              <CalendarIcon className="w-3.5 h-3.5" />
              {`${format(weekRange.from, "dd MMM", { locale: ptBR })} — ${format(weekRange.to, "dd MMM yyyy", { locale: ptBR })}`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className={popoverClass} align="start">
            <Calendar
              mode="range"
              selected={{ from: weekRange.from, to: weekRange.to }}
              onDayClick={handleWeekDayClick}
              onDayMouseEnter={handleWeekDayHover}
              onDayMouseLeave={() => setHoveredWeek(null)}
              modifiers={weekModifiers}
              modifiersStyles={weekModifiersStyles}
              locale={ptBR}
              defaultMonth={weekRange.from}
              weekStartsOn={1}
              className="[&_.rdp-row]:rounded-md [&_.rdp-row:hover]:bg-primary/[0.04] [&_.rdp-row]:transition-colors"
            />
          </PopoverContent>
        </Popover>
      )}

      {period === "custom" && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={triggerBtnClass}>
              <CalendarIcon className="w-3.5 h-3.5" />
              {customRange?.from && customRange?.to
                ? `${format(customRange.from, "dd MMM", { locale: ptBR })} — ${format(customRange.to, "dd MMM yyyy", { locale: ptBR })}`
                : customRange?.from
                  ? `${format(customRange.from, "dd MMM", { locale: ptBR })} — ...`
                  : "Selecionar intervalo"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className={popoverClass} align="start">
            <Calendar
              mode="range"
              selected={customRange?.from ? { from: customRange.from, to: customRange.to } : undefined}
              onSelect={handleCustomRangeSelect}
              numberOfMonths={2}
              locale={ptBR}
              defaultMonth={customRange?.from ?? now}
            />
          </PopoverContent>
        </Popover>
      )}

      <span className="text-xs text-muted-foreground/70 tabular-nums">{summaryText}</span>
    </div>
  );
}

function getSummaryText(state: MetricsPeriodState, now: Date): string {
  const { period, month, year, customRange, weekDate } = state;

  if (period === "all") return "Métricas do pipe no geral";

  if (period === "month") {
    return `Métricas de ${format(new Date(year, month - 1), "MMMM/yyyy", { locale: ptBR })}`;
  }

  if (period === "week") {
    const wr = getWeekRange(weekDate ?? now);
    return `Semana de ${format(wr.from, "dd MMM", { locale: ptBR })} a ${format(wr.to, "dd MMM", { locale: ptBR })}`;
  }

  if (period === "custom") {
    if (customRange?.from && customRange?.to) {
      return `${format(customRange.from, "dd MMM yyyy", { locale: ptBR })} — ${format(customRange.to, "dd MMM yyyy", { locale: ptBR })}`;
    }
    if (customRange?.from) {
      return `A partir de ${format(customRange.from, "dd MMM", { locale: ptBR })} — selecione a data final`;
    }
  }

  return "Selecione o intervalo";
}
