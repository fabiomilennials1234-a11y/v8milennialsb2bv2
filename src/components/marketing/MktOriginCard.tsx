import { memo } from "react";
import { cn } from "@/lib/utils";
import { Crown, Medal, Award, DollarSign, Trophy, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";
import { useCountUp } from "@/hooks/useCountUp";
import type { OriginMetrics } from "@/hooks/useMktByOrigin";
import type { MktOriginConfig } from "@/hooks/useMktOriginConfig";
import { ORIGIN_LABELS, ORIGIN_COLORS, type LeadOrigin } from "@/hooks/useMktOriginConfig";
import { MktUtmBreakdown } from "./MktUtmBreakdown";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

const RANK_ICONS = [Crown, Medal, Award] as const;
const RANK_BG = [
  "bg-yellow-500/15 text-yellow-500",
  "bg-slate-400/15 text-slate-400",
  "bg-amber-600/15 text-amber-600",
];

interface MktOriginCardProps {
  metrics: OriginMetrics;
  config?: MktOriginConfig;
  rank: number;
  index: number;
  leads?: Array<{ id: string; utm_campaign?: string | null; origin?: string | null }>;
  propostas?: Array<{ lead_id: string; status?: string }>;
}

function MktOriginCardBase({ metrics, config, rank, index, leads, propostas }: MktOriginCardProps) {
  const origin = metrics.origin as LeadOrigin;
  const label = ORIGIN_LABELS[origin] ?? origin;
  const color = ORIGIN_COLORS[origin] ?? "#64748B";
  const animatedLeads = useCountUp(metrics.leadsCount, 1200, true);

  const showLeads = config?.show_leads !== false;
  const showAgendamentos = config?.show_agendamentos !== false;
  const showComparecimentos = config?.show_comparecimentos !== false;
  const showVendas = config?.show_vendas !== false;

  const hasInvestment = metrics.investimentoReais > 0;

  const funnelSteps = [
    { show: showLeads, label: "Leads", value: metrics.leadsCount },
    { show: showAgendamentos, label: "Agend.", value: metrics.agendamentosCount },
    { show: showComparecimentos, label: "Compar.", value: metrics.comparecimentosCount },
    { show: showVendas, label: "Vendas", value: metrics.vendasCount },
  ].filter((s) => s.show);

  const maxFunnel = Math.max(...funnelSteps.map((s) => s.value), 1);

  const RankIcon = rank <= 3 ? RANK_ICONS[rank - 1] : null;
  const rankBg = rank <= 3 ? RANK_BG[rank - 1] : "bg-muted text-muted-foreground";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35 }}
      whileHover={{ scale: 1.015, y: -3 }}
      className="relative bg-card rounded-lg border border-border p-5 pl-[22px] overflow-hidden transition-colors hover:border-border/80 cursor-default group"
    >
      {/* Accent stripe */}
      <div
        className="absolute left-0 top-0 w-[3px] h-full opacity-60 group-hover:opacity-100 transition-opacity"
        style={{ backgroundColor: color }}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={cn("w-[26px] h-[26px] rounded-md flex items-center justify-center", rankBg)}>
            {RankIcon ? (
              <RankIcon className="w-[13px] h-[13px]" />
            ) : (
              <span className="text-[11px] font-bold">{rank}</span>
            )}
          </div>
          <span className="text-sm font-semibold">{label}</span>
        </div>
        {hasInvestment && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary">
            {formatCurrency(metrics.investimentoReais)}
          </span>
        )}
      </div>

      {/* Main value + ROI */}
      <div className="flex items-baseline gap-3">
        <div>
          <p className="text-[26px] font-extrabold tracking-[-0.03em] tabular-nums leading-none">
            {Math.round(animatedLeads).toLocaleString("pt-BR")}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">leads captados</p>
        </div>
        {hasInvestment && showVendas && metrics.roi !== 0 && (
          <span
            className={cn(
              "text-[11px] font-bold px-2 py-0.5 rounded-md inline-flex items-center gap-1",
              metrics.roi > 0
                ? "bg-success/10 text-success"
                : "bg-destructive/10 text-destructive"
            )}
          >
            <TrendingUp className="w-[11px] h-[11px]" />
            ROI {metrics.roi > 0 ? "+" : ""}
            {metrics.roi.toFixed(0)}%
          </span>
        )}
      </div>

      {/* Mini funnel */}
      <div className="flex flex-col gap-[5px] mt-3.5">
        {funnelSteps.map((step, i) => (
          <div key={step.label} className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-muted-foreground/60 w-12 text-right shrink-0">
              {step.label}
            </span>
            <div className="flex-1 h-[6px] rounded-full bg-muted overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{
                  width: `${Math.max((step.value / maxFunnel) * 100, step.value > 0 ? 4 : 0)}%`,
                }}
                transition={{ delay: index * 0.06 + i * 0.08 + 0.2, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="h-full rounded-full"
                style={{ backgroundColor: color, opacity: 0.7 }}
              />
            </div>
            <span className="text-[11px] font-semibold tabular-nums w-7 text-right">{step.value}</span>
          </div>
        ))}
      </div>

      {/* Bottom stats */}
      {hasInvestment && (
        <div className="grid grid-cols-3 gap-2 mt-3.5 pt-3.5 border-t border-border/50">
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center">
              <DollarSign className="w-3 h-3 text-muted-foreground" />
            </div>
            <div>
              <p className="text-[11px] font-bold tabular-nums">{formatCurrency(metrics.custoPorLead)}</p>
              <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-[0.04em]">
                Custo/Lead
              </p>
            </div>
          </div>
          {showVendas && (
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center">
                <Trophy className="w-3 h-3 text-muted-foreground" />
              </div>
              <div>
                <p className="text-[11px] font-bold tabular-nums">{formatCurrency(metrics.custoPorVenda)}</p>
                <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-[0.04em]">
                  Custo/Venda
                </p>
              </div>
            </div>
          )}
          {showVendas && (
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center">
                <TrendingUp className="w-3 h-3 text-muted-foreground" />
              </div>
              <div>
                <p
                  className={cn(
                    "text-[11px] font-bold tabular-nums",
                    metrics.conversionRate >= 5 ? "text-success" : ""
                  )}
                >
                  {metrics.conversionRate.toFixed(1)}%
                </p>
                <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-[0.04em]">
                  Conversão
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* UTM breakdown for meta_ads */}
      {origin === "meta_ads" && leads && propostas && (
        <MktUtmBreakdown leads={leads} propostas={propostas} />
      )}

      {/* No investment hint */}
      {!hasInvestment && metrics.leadsCount > 0 && (
        <div className="mt-3.5 pt-3.5 border-t border-border/50 flex items-center justify-between">
          {showVendas && (
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center">
                <TrendingUp className="w-3 h-3 text-muted-foreground" />
              </div>
              <div>
                <p className="text-[11px] font-bold tabular-nums">{metrics.conversionRate.toFixed(1)}%</p>
                <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-[0.04em]">
                  Conversão
                </p>
              </div>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground/40">
            Configure investimento para ver custos
          </p>
        </div>
      )}
    </motion.div>
  );
}

export const MktOriginCard = memo(MktOriginCardBase);
