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
import { KpiRow, KpiTile } from "@/components/ui/bento";
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
// MovimentacaoTile — V5: o `KpiTile` do bento (rótulo, número grande, chip
// tintado) com o count-up de sempre. O wrapper animado carrega o `role=group`
// e o nome acessível que os testes e o leitor de tela usam.
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

  const note =
    (hero && subValue) || emptyCaption ? (
      <>
        {hero && subValue && (
          <>
            <span className="font-medium">{subValue.caption}</span>{" "}
            <span className="font-bold tabular-nums text-foreground/90">{subValue.amount}</span>
          </>
        )}
        {emptyCaption}
      </>
    ) : undefined;

  return (
    <motion.div
      role="group"
      aria-label={ariaLabel}
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: reduceMotion ? 0 : delay }}
      className="min-w-0"
    >
      <KpiTile
        className="h-full"
        label={label}
        value={Math.round(display).toLocaleString("pt-BR")}
        icon={Icon}
        tone={hero ? "gold" : "neutral"}
        note={note}
      />
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
      {/* Alternador claro do V5 (mesma forma do `TabsList variant="segmented"`),
          mas continua sendo grupo de BOTÕES com aria-pressed — trocar para
          aba mudaria o papel que o teste e o leitor de tela esperam. */}
      <div
        role="group"
        aria-label="Período das movimentações"
        className="inline-flex items-center gap-0.5 rounded-full bg-muted p-[3px]"
      >
        {MOVIMENTACOES_PRESETS.map((p) => {
          const active = state.preset === p.value;
          return (
            <button
              key={p.value}
              type="button"
              aria-pressed={active}
              onClick={() => handlePreset(p.value)}
              className={cn(
                "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-card text-foreground shadow-relevo"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {state.preset === "custom" && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs tabular-nums">
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
      className="space-y-3"
      aria-label="Movimentações no período"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h2 className="text-[15px] font-bold tracking-[-0.02em]">
            Movimentações no período
          </h2>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="O que isto conta?"
                  className="inline-flex items-center justify-center rounded-full p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      <div>
        {isError ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-card-border bg-card px-4 py-8 text-center shadow-relevo">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertTriangle className="w-5 h-5" />
            </span>
            <p className="text-sm text-muted-foreground">
              Não foi possível carregar as movimentações.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Skeleton className="h-[92px] rounded-card" />
            <Skeleton className="h-[92px] rounded-card" />
            <Skeleton className="h-[92px] rounded-card" />
          </div>
        ) : (
          <KpiRow cols={3}>
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
          </KpiRow>
        )}
      </div>
    </motion.section>
  );
}

export default MovimentacoesPanel;
