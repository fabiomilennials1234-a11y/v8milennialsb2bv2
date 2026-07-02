import { useCallback } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange as RDPDateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import type {
  SaudePeriodPreset,
  SaudeCustomRange,
} from "@/modules/analytics/lib/saude-period";

interface SaudePeriodFilterProps {
  preset: SaudePeriodPreset;
  customRange: SaudeCustomRange | null;
  onPresetChange: (preset: SaudePeriodPreset) => void;
  onCustomRangeChange: (range: SaudeCustomRange | null) => void;
}

/**
 * Filtro de período local da aba Saúde — segmented Hoje | Essa semana |
 * Esse mês | Personalizado. Mesma semântica de datas do Comando
 * (computeSaudePeriodRange); Personalizado abre range picker de 2 meses,
 * no mesmo padrão do MetricsPeriodSelector dos funis.
 */
export function SaudePeriodFilter({
  preset,
  customRange,
  onPresetChange,
  onCustomRangeChange,
}: SaudePeriodFilterProps) {
  // Aceita estado intermediário (só `from`, sem `to`) — primeiro clique.
  const handleCustomRangeSelect = useCallback(
    (range: RDPDateRange | undefined) => {
      onCustomRangeChange(range?.from ? { from: range.from, to: range.to } : null);
    },
    [onCustomRangeChange],
  );

  const triggerBtnClass = cn(
    "h-9 gap-2 text-xs font-medium",
    "border-border/50 bg-secondary/30 text-muted-foreground",
    "hover:bg-secondary/60 hover:text-foreground hover:border-border",
    "transition-colors",
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Tabs value={preset} onValueChange={(v) => onPresetChange(v as SaudePeriodPreset)}>
        <TabsList className="h-9">
          <TabsTrigger value="today" className="gap-1.5 text-xs">Hoje</TabsTrigger>
          <TabsTrigger value="week" className="gap-1.5 text-xs">Essa semana</TabsTrigger>
          <TabsTrigger value="month" className="gap-1.5 text-xs">Esse mês</TabsTrigger>
          <TabsTrigger value="custom" className="gap-1.5 text-xs">Personalizado</TabsTrigger>
        </TabsList>
      </Tabs>

      {preset === "custom" && (
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
          <PopoverContent
            className="w-auto p-0 border-border/60 shadow-lg dark:shadow-black/40 dark:bg-popover"
            align="end"
          >
            <Calendar
              mode="range"
              selected={
                customRange?.from ? { from: customRange.from, to: customRange.to } : undefined
              }
              onSelect={handleCustomRangeSelect}
              numberOfMonths={2}
              locale={ptBR}
              defaultMonth={customRange?.from ?? new Date()}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
