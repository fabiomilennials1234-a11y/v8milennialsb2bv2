import { Calendar as CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MetricsPeriodSelector } from "@/components/pipelines/MetricsPeriodSelector";
import { type MetricsPeriodState, createInitialPeriodState } from "@/lib/metrics-period";
import { cn } from "@/lib/utils";

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function formatPeriodLabel(range: { startStr: string; endStr: string }): string {
  const [sy, sm, sd] = range.startStr.slice(0, 10).split("-").map(Number);
  const [ey, em, ed] = range.endStr.slice(0, 10).split("-").map(Number);
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS_PT[em - 1]} ${ey}`;
  if (sy === ey) return `${sd} ${MONTHS_PT[sm - 1]} – ${ed} ${MONTHS_PT[em - 1]} ${ey}`;
  return `${sd} ${MONTHS_PT[sm - 1]} ${sy} – ${ed} ${MONTHS_PT[em - 1]} ${ey}`;
}

export interface PipePeriodChipProps {
  state: MetricsPeriodState;
  onChange: (state: MetricsPeriodState) => void;
  /** Active range for display (when period !== "all") */
  activeRange?: { startStr: string; endStr: string } | null;
}

export function PipePeriodChip({ state, onChange, activeRange }: PipePeriodChipProps) {
  const isAll = state.period === "all";
  const label = isAll ? "Período: Geral" : activeRange ? formatPeriodLabel(activeRange) : "Período";

  return (
    <Popover>
      <div className="flex items-center gap-1">
        <PopoverTrigger asChild>
          <button
            className={cn("filter-chip", !isAll && "filter-chip-active")}
            aria-label="Selecionar período das métricas"
          >
            <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
            <span className="tabular-nums">
              {isAll ? "Período: " : ""}
              <span className={cn(!isAll && "chip-value font-semibold text-primary")}>{isAll ? "Geral" : label}</span>
            </span>
          </button>
        </PopoverTrigger>
        {!isAll && (
          <button
            onClick={() => onChange(createInitialPeriodState())}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
            aria-label="Remover filtro de período"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <PopoverContent align="start" className="w-auto p-3" sideOffset={8}>
        <MetricsPeriodSelector state={state} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
