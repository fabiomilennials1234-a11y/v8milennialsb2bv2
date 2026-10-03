import { memo, useCallback } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import type {
  CommandPeriod,
  CommandCustomRange,
} from "@/modules/analytics/hooks/useCommandMetrics";

interface CommandHeaderProps {
  month: number;
  year: number;
  onMonthChange: (month: number, year: number) => void;
  period: CommandPeriod;
  onPeriodChange: (period: CommandPeriod) => void;
  customRange: CommandCustomRange | null;
  onCustomRangeChange: (range: CommandCustomRange | null) => void;
  onNewLead: () => void;
  showAnalytics: boolean;
  subtitle: string;
}

const PERIODS: Array<{ key: CommandPeriod; label: string }> = [
  { key: "today", label: "Hoje" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mês" },
  { key: "quarter", label: "Trim." },
  { key: "custom", label: "Personalizado" },
];

const TAB_TRIGGER_CLASS = cn(
  "relative rounded-none border-0 bg-transparent px-3.5 py-[9px] text-[13px] font-semibold text-muted-foreground shadow-none transition-colors",
  "hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none",
  "after:absolute after:inset-x-3.5 after:-bottom-[13px] after:h-[2px] after:rounded-sm after:bg-primary after:opacity-0 after:content-['']",
  "data-[state=active]:after:opacity-100",
);

/**
 * Header da Central de Comando — identidade + tabs underline + período + novo lead.
 * Deve ser renderizado dentro de <Tabs> (consome o contexto do shadcn).
 */
function CommandHeaderBase({
  month, year, onMonthChange, period, onPeriodChange,
  customRange, onCustomRangeChange, onNewLead, showAnalytics, subtitle,
}: CommandHeaderProps) {
  const now = new Date();
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();

  const goToPrevMonth = () =>
    month === 1 ? onMonthChange(12, year - 1) : onMonthChange(month - 1, year);
  const goToNextMonth = () =>
    month === 12 ? onMonthChange(1, year + 1) : onMonthChange(month + 1, year);

  // Aceita estado intermediário (só `from`, sem `to`) — primeiro clique.
  const handleCustomSelect = useCallback(
    (r: DateRange | undefined) =>
      onCustomRangeChange(r?.from ? { from: r.from, to: r.to } : null),
    [onCustomRangeChange],
  );

  return (
    <div className="cmd-rise flex flex-col gap-3 border-b border-border/70 pb-3 md:flex-row md:items-center md:gap-[22px]">
      <div className="min-w-0">
        <h1 className="text-[19px] font-extrabold tracking-[-0.03em]">Comando</h1>
        <div className="group flex items-center gap-1 text-[12px] text-muted-foreground">
          {period === "month" && (
            <button
              type="button"
              onClick={goToPrevMonth}
              aria-label="Mês anterior"
              className="opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
          )}
          <span className="whitespace-nowrap">{subtitle}</span>
          {period === "month" && (
            <button
              type="button"
              onClick={goToNextMonth}
              disabled={isCurrentMonth}
              aria-label="Próximo mês"
              className="opacity-0 transition-opacity hover:text-foreground disabled:invisible group-hover:opacity-100"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <TabsList className="ml-0 h-auto max-w-full justify-start gap-1 overflow-x-auto scrollbar-hide bg-transparent p-0 md:ml-[18px]">
        <TabsTrigger value="proximos-passos" className={TAB_TRIGGER_CLASS}>Próximos passos</TabsTrigger>
        <TabsTrigger value="visao-geral" className={TAB_TRIGGER_CLASS}>Visão Geral</TabsTrigger>
        <TabsTrigger value="performance" className={TAB_TRIGGER_CLASS}>Performance</TabsTrigger>
        <TabsTrigger value="saude" className={TAB_TRIGGER_CLASS}>Saúde</TabsTrigger>
        <TabsTrigger value="mapa" className={TAB_TRIGGER_CLASS}>Mapa</TabsTrigger>
        {showAnalytics && (
          <TabsTrigger value="analytics" className={TAB_TRIGGER_CLASS}>Analytics</TabsTrigger>
        )}
      </TabsList>

      <div className="hidden md:block md:flex-1" />

      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide [&>*]:shrink-0">
        <div className="flex gap-[2px] rounded-[9px] border border-border bg-card p-[3px]">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onPeriodChange(p.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[12px] font-semibold transition-all",
                period === p.key
                  ? "bg-background text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {period === "custom" && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-[7px] rounded-[9px] border border-border bg-card px-3 py-[7px] text-[12px] font-semibold transition-colors",
                  customRange?.from
                    ? "text-foreground hover:border-primary/50"
                    : "text-muted-foreground hover:text-foreground hover:border-border",
                )}
              >
                <CalendarDays className="h-3.5 w-3.5" />
                {customRange?.from && customRange?.to
                  ? `${format(customRange.from, "dd MMM", { locale: ptBR })} — ${format(customRange.to, "dd MMM", { locale: ptBR })}`
                  : customRange?.from
                    ? `${format(customRange.from, "dd MMM", { locale: ptBR })} — ...`
                    : "Selecionar intervalo"}
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-auto border-border/60 p-0 shadow-lg dark:bg-popover dark:shadow-black/40"
              align="end"
            >
              <Calendar
                mode="range"
                selected={customRange?.from ? { from: customRange.from, to: customRange.to } : undefined}
                onSelect={handleCustomSelect}
                numberOfMonths={2}
                locale={ptBR}
                defaultMonth={customRange?.from ?? new Date()}
              />
            </PopoverContent>
          </Popover>
        )}

        <button
          type="button"
          onClick={onNewLead}
          className="inline-flex items-center gap-[7px] rounded-[9px] bg-primary px-4 py-[9px] text-[13px] font-bold text-primary-foreground shadow-[inset_0_1px_0_hsl(47_100%_65%/.45),0_6px_18px_hsl(var(--primary)/.18)] transition-transform duration-150 hover:-translate-y-px"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          Novo lead
        </button>
      </div>
    </div>
  );
}

export const CommandHeader = memo(CommandHeaderBase);
