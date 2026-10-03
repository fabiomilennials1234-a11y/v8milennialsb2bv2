import { memo, useCallback, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Info,
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  CalendarCheck2,
  CircleDollarSign,
  type LucideIcon,
} from "lucide-react";
import type { DateRange as RDPDateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePersistedState } from "@/shared/hooks/usePersistedState";
import { useCountUp } from "@/shared/hooks/useCountUp";
import { useMovimentacoesPeriodo } from "@/modules/analytics/hooks/useMovimentacoesPeriodo";
import {
  DEFAULT_MOVIMENTACOES_PERIOD,
  MOVIMENTACOES_PRESETS,
  resolveMovimentacoesRange,
  customRangeFromState,
  type MovimentacoesPreset,
  type MovimentacoesPeriodState,
} from "@/modules/analytics/lib/movimentacoes-period";

// ────────────────────────────────────────────────────────────────────────
// MovimentacaoTile — anatomia fiel ao KPICard (racing-stripe + chip + count-up)
// ────────────────────────────────────────────────────────────────────────
interface MovimentacaoTileProps {
  label: string;
  value: number;
  icon: LucideIcon;
  ariaLabel: string;
  subValue?: { caption: string; amount: string };
  hero?: boolean;
  delay?: number;
  emptyCaption?: string;
}

function MovimentacaoTileBase({
  label,
  value,
  icon: Icon,
  ariaLabel,
  subValue,
  hero = false,
  delay = 0,
  emptyCaption,
}: MovimentacaoTileProps) {
  const reduceMotion = useReducedMotion();
  const animated = useCountUp(value, 1200, !reduceMotion);
  const display = reduceMotion ? value : animated;

  return (
    <motion.div
      role="group"
      aria-label={ariaLabel}
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: reduceMotion ? 0 : delay }}
      className="relative bg-card rounded-lg border border-border p-5 overflow-hidden group"
    >
      {/* Racing stripe */}
      <div
        className={cn(
          "absolute left-0 top-0 w-[3px] h-full transition-colors",
          hero ? "bg-primary" : "bg-primary/60 group-hover:bg-primary",
        )}
      />

      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-1.5 text-2xl font-extrabold tracking-[-0.03em] tabular-nums text-foreground">
            {Math.round(display).toLocaleString("pt-BR")}
          </p>

          {hero && subValue && (
            <p className="mt-1 text-sm font-bold tabular-nums text-foreground/90">
              <span className="text-[11px] font-medium text-muted-foreground">
                {subValue.caption}
              </span>{" "}
              {subValue.amount}
            </p>
          )}

          {emptyCaption && (
            <p className="mt-1 text-[11px] text-muted-foreground">{emptyCaption}</p>
          )}
        </div>

        <div
          className={cn(
            "p-2.5 rounded-lg",
            hero ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="w-4 h-4" />
        </div>
      </div>
    </motion.div>
  );
}

const MovimentacaoTile = memo(MovimentacaoTileBase);

// ────────────────────────────────────────────────────────────────────────
// PeriodRangeControl — presets em pílula + Popover de range quando Custom
// ────────────────────────────────────────────────────────────────────────
interface PeriodRangeControlProps {
  state: MovimentacoesPeriodState;
  onChange: (next: MovimentacoesPeriodState) => void;
}

function PeriodRangeControl({ state, onChange }: PeriodRangeControlProps) {
  const custom = useMemo(() => customRangeFromState(state), [state]);

  const handlePreset = useCallback(
    (preset: MovimentacoesPreset) => onChange({ ...state, preset }),
    [state, onChange],
  );

  const handleRangeSelect = useCallback(
    (range: RDPDateRange | undefined) => {
      onChange({
        ...state,
        preset: "custom",
        customFrom: range?.from ? range.from.toISOString() : null,
        customTo: range?.to ? range.to.toISOString() : null,
      });
    },
    [state, onChange],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label="Período das movimentações"
        className="flex gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5"
      >
        {MOVIMENTACOES_PRESETS.map((p) => {
          const active = state.preset === p.value;
          return (
            <Button
              key={p.value}
              type="button"
              variant={active ? "default" : "ghost"}
              size="sm"
              aria-pressed={active}
              onClick={() => handlePreset(p.value)}
              className="h-7 px-3 text-xs rounded-md focus-visible:ring-2 focus-visible:ring-ring"
            >
              {p.label}
            </Button>
          );
        })}
      </div>

      {state.preset === "custom" && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
              <CalendarDays className="w-3.5 h-3.5" />
              {custom?.from && custom?.to
                ? `${format(custom.from, "dd MMM", { locale: ptBR })} — ${format(custom.to, "dd MMM yyyy", { locale: ptBR })}`
                : custom?.from
                  ? `${format(custom.from, "dd MMM", { locale: ptBR })} — ...`
                  : "Selecionar intervalo"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0">
            <Calendar
              mode="range"
              selected={custom?.from ? { from: custom.from, to: custom.to } : undefined}
              onSelect={handleRangeSelect}
              numberOfMonths={2}
              locale={ptBR}
              defaultMonth={custom?.from ?? new Date()}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// MovimentacoesPanel
// ────────────────────────────────────────────────────────────────────────
export function MovimentacoesPanel() {
  const reduceMotion = useReducedMotion();
  const [period, setPeriod] = usePersistedState<MovimentacoesPeriodState>(
    "perf-movimentacoes-period",
    DEFAULT_MOVIMENTACOES_PERIOD,
  );

  const range = useMemo(
    () => resolveMovimentacoesRange(period.preset, customRangeFromState(period)),
    [period],
  );

  const { marcadas, comparecidas, vendidoCount, vendidoReceita, isLoading, isError, refetch } =
    useMovimentacoesPeriodo(range?.start ?? null, range?.end ?? null);

  const isEmpty = !isLoading && !isError && marcadas === 0 && comparecidas === 0 && vendidoCount === 0;
  const receitaFormatada = `R$ ${vendidoReceita.toLocaleString("pt-BR")}`;

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="glass-card rounded-xl p-5"
      aria-label="Movimentações no período"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h2 className="text-base font-semibold tracking-[-0.015em]">
            Movimentações no período
          </h2>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="O que isto conta?"
                  className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[240px]">
                Conta por data de movimentação, não por data de criação do lead.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <PeriodRangeControl state={period} onChange={setPeriod} />
      </div>

      <div className="mt-4">
        {isError ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            <p className="text-sm text-muted-foreground">
              Não foi possível carregar as movimentações.
            </p>
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Skeleton className="h-[92px] rounded-lg" />
            <Skeleton className="h-[92px] rounded-lg" />
            <Skeleton className="h-[92px] rounded-lg" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MovimentacaoTile
              label="Marcadas"
              value={marcadas}
              icon={CalendarPlus}
              ariaLabel={`Marcadas: ${marcadas} ${marcadas === 1 ? "reunião" : "reuniões"}`}
              delay={0}
              emptyCaption={isEmpty ? "Nenhuma movimentação neste período." : undefined}
            />
            <MovimentacaoTile
              label="Comparecidas"
              value={comparecidas}
              icon={CalendarCheck2}
              ariaLabel={`Comparecidas: ${comparecidas} ${comparecidas === 1 ? "reunião" : "reuniões"}`}
              delay={0.06}
            />
            <MovimentacaoTile
              label="Vendido"
              value={vendidoCount}
              icon={CircleDollarSign}
              hero
              ariaLabel={`Vendido: ${vendidoCount} ${vendidoCount === 1 ? "venda" : "vendas"}, ${receitaFormatada} de receita`}
              subValue={{ caption: "Receita ·", amount: receitaFormatada }}
              delay={0.12}
            />
          </div>
        )}
      </div>
    </motion.section>
  );
}

export default MovimentacoesPanel;
