import { cn } from "@/lib/utils";
import { Users, Calendar, Target, FileText, Trophy, DollarSign, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";
import type { OriginMetrics } from "@/hooks/useMktByOrigin";
import type { MktOriginConfig } from "@/hooks/useMktOriginConfig";
import { ORIGIN_LABELS, ORIGIN_COLORS, type LeadOrigin } from "@/hooks/useMktOriginConfig";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

interface MktOriginCardProps {
  metrics: OriginMetrics;
  config?: MktOriginConfig;
  index: number;
}

export function MktOriginCard({ metrics, config, index }: MktOriginCardProps) {
  const origin = metrics.origin as LeadOrigin;
  const label = ORIGIN_LABELS[origin] ?? origin;
  const color = ORIGIN_COLORS[origin] ?? "#64748B";

  // What metrics to show (default: all true)
  const showLeads = config?.show_leads !== false;
  const showAgendamentos = config?.show_agendamentos !== false;
  const showComparecimentos = config?.show_comparecimentos !== false;
  const showPropostas = config?.show_propostas !== false;
  const showVendas = config?.show_vendas !== false;

  const hasInvestment = metrics.investimentoReais > 0;

  // Funnel steps for the mini visual
  const funnelSteps = [
    { show: showLeads, label: "Leads", value: metrics.leadsCount },
    { show: showAgendamentos, label: "Agend.", value: metrics.agendamentosCount },
    { show: showComparecimentos, label: "Compar.", value: metrics.comparecimentosCount },
    { show: showPropostas, label: "Prop.", value: metrics.propostasAbertas + metrics.propostasFechadas },
    { show: showVendas, label: "Vendas", value: metrics.vendasCount },
  ].filter((s) => s.show);

  const maxFunnel = Math.max(...funnelSteps.map((s) => s.value), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className={cn(
        "glass-card rounded-2xl p-5 transition-all duration-300",
        "hover:shadow-lg hover:border-border"
      )}
    >
      {/* Header with origin badge */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
          <h3 className="text-base font-semibold text-foreground">{label}</h3>
        </div>
        {hasInvestment && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
            {formatCurrency(metrics.investimentoReais)}
          </span>
        )}
      </div>

      {/* Main metric: leads count */}
      {showLeads && (
        <div className="mb-4">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-foreground">{metrics.leadsCount}</span>
            <span className="text-sm text-muted-foreground">leads</span>
          </div>
        </div>
      )}

      {/* Mini funnel bars */}
      <div className="space-y-2 mb-4">
        {funnelSteps.map((step) => (
          <div key={step.label} className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground w-14 shrink-0 text-right">
              {step.label}
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.max((step.value / maxFunnel) * 100, step.value > 0 ? 4 : 0)}%` }}
                transition={{ delay: index * 0.05 + 0.2, duration: 0.4 }}
                className="h-full rounded-full"
                style={{ backgroundColor: color, opacity: 0.7 }}
              />
            </div>
            <span className="text-xs font-medium text-foreground w-8 text-right">
              {step.value}
            </span>
          </div>
        ))}
      </div>

      {/* Cost metrics (only if investment > 0) */}
      {hasInvestment && (
        <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border/50">
          <div className="flex items-center gap-1.5">
            <DollarSign className="w-3 h-3 text-muted-foreground" />
            <div>
              <p className="text-[10px] text-muted-foreground">Custo/Lead</p>
              <p className="text-xs font-semibold">{formatCurrency(metrics.custoPorLead)}</p>
            </div>
          </div>
          {showVendas && (
            <div className="flex items-center gap-1.5">
              <Trophy className="w-3 h-3 text-muted-foreground" />
              <div>
                <p className="text-[10px] text-muted-foreground">Custo/Venda</p>
                <p className="text-xs font-semibold">{formatCurrency(metrics.custoPorVenda)}</p>
              </div>
            </div>
          )}
          {showVendas && (
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3 text-muted-foreground" />
              <div>
                <p className="text-[10px] text-muted-foreground">Conversão</p>
                <p className="text-xs font-semibold">{metrics.conversionRate.toFixed(1)}%</p>
              </div>
            </div>
          )}
          {showVendas && metrics.roi !== 0 && (
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3 text-muted-foreground" />
              <div>
                <p className="text-[10px] text-muted-foreground">ROI</p>
                <p className={cn(
                  "text-xs font-semibold",
                  metrics.roi > 0 ? "text-emerald-500" : "text-red-500"
                )}>
                  {metrics.roi > 0 ? "+" : ""}{metrics.roi.toFixed(0)}%
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* No investment message */}
      {!hasInvestment && metrics.leadsCount > 0 && (
        <p className="text-[10px] text-muted-foreground pt-2 border-t border-border/50">
          Configure o investimento para ver custos e ROI
        </p>
      )}
    </motion.div>
  );
}
