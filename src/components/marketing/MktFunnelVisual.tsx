import { motion } from "framer-motion";
import { DollarSign, Users, Calendar, FileText, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MktFunnelData } from "@/hooks/useMktFunnel";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

interface MktFunnelVisualProps {
  data: MktFunnelData;
  variant: "cal" | "cadastro";
  className?: string;
}

/** Cores distintas por etapa (estilo Incident Report: azul, teal, ciano, roxo, etc.) */
const BAR_COLORS = [
  "bg-blue-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-violet-500",
  "bg-emerald-500",
] as const;

export function MktFunnelVisual({ data, variant, className }: MktFunnelVisualProps) {
  const leadLabel =
    variant === "cal"
      ? "Quiz / Call"
      : "Quiz / Cadastro";

  const steps = [
    { label: "Investimento", value: formatCurrency(data.investimentoReais), count: data.investimentoReais },
    { label: leadLabel, value: String(data.leadsCount), count: data.leadsCount },
    { label: "Agendamento", value: String(data.agendamentosCount), count: data.agendamentosCount },
    { label: "Propostas", value: `${data.propostasAbertas} / ${data.propostasFechadas}`, count: data.propostasAbertas + data.propostasFechadas },
    { label: "Vendas", value: String(data.vendasCount), count: data.vendasCount },
  ];

  const maxCount = Math.max(
    1,
    data.leadsCount,
    data.agendamentosCount,
    data.propostasAbertas + data.propostasFechadas,
    data.vendasCount
  );

  return (
    <div className={cn("space-y-5", className)}>
      {/* Gráfico de barras horizontais — etapas no eixo vertical, barra à direita */}
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="space-y-3">
          {steps.map((step, i) => {
            const widthPct =
              i === 0 || i === 1
                ? 100
                : Math.max(12, (step.count / maxCount) * 100);
            const color = BAR_COLORS[i];

            return (
              <motion.div
                key={step.label}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className="flex items-center gap-3"
              >
                <div className="w-[140px] shrink-0">
                  <span className="text-sm font-medium text-foreground">
                    {step.label}
                  </span>
                </div>
                <div className="flex-1 min-w-0 h-9 rounded-md overflow-hidden bg-background/60 border border-border/50">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${widthPct}%` }}
                    transition={{
                      duration: 0.6,
                      delay: i * 0.08 + 0.15,
                      ease: "easeOut",
                    }}
                    className={cn(
                      "h-full rounded-md flex items-center justify-end pr-2 min-w-[2rem]",
                      color,
                      "text-white text-xs font-semibold"
                    )}
                  >
                    {widthPct > 20 && (
                      <span className="truncate">{step.value}</span>
                    )}
                  </motion.div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Métricas de resumo — duas colunas, estilo Incident Report */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
            Investimento total
          </p>
          <p className="text-lg font-bold text-foreground">
            {formatCurrency(data.investimentoReais)}
          </p>
          {data.leadsCount > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {formatCurrency(data.custoPorLead)} por lead
            </p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
            Total leads
          </p>
          <p className="text-lg font-bold text-foreground">
            {data.leadsCount}
          </p>
          {data.agendamentosCount > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {data.agendamentosCount} agendamentos · {data.comparecimentosCount} compareceram
            </p>
          )}
          {data.agendamentosCount > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Custo por reunião: {formatCurrency(data.custoPorAgendamento)}
            </p>
          )}
          {data.comparecimentosCount > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Custo por reunião comparecida: {formatCurrency(data.custoPorComparecimento)}
            </p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
            Vendas
          </p>
          <p className="text-lg font-bold text-foreground">
            {data.vendasCount}
          </p>
          {data.vendasCount > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {formatCurrency(data.custoPorVenda)} por venda
            </p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
            Taxa de conversão
          </p>
          <p className="text-lg font-bold text-foreground">
            {data.leadsCount > 0
              ? `${((data.vendasCount / data.leadsCount) * 100).toFixed(1)}%`
              : "—"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            vendas / leads
          </p>
        </div>
      </div>
    </div>
  );
}
