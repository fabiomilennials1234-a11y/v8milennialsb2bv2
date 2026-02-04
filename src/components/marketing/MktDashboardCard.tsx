import React, { useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Calendar,
  FileEdit,
  Loader2,
  ChevronRight,
  Download,
  DollarSign,
  Users,
  Target,
  Trophy,
  TrendingUp,
  FileText,
} from "lucide-react";
import { MktFunnelVisual } from "./MktFunnelVisual";
import type { MktFunnelData } from "@/hooks/useMktFunnel";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export type MktDashboardVariant = "cal" | "cadastro";

interface MktDashboardCardProps {
  variant: MktDashboardVariant;
  data: MktFunnelData | null;
  isLoading: boolean;
  onViewDetails: () => void;
}

const TAB_IDS = ["overview", "analytics", "reports"] as const;
type TabId = (typeof TAB_IDS)[number];

const TAB_LABELS: Record<TabId, string> = {
  overview: "Visão geral",
  analytics: "Métricas",
  reports: "Resumo",
};

export function MktDashboardCard({
  variant,
  data,
  isLoading,
  onViewDetails,
}: MktDashboardCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateY = ((x - centerX) / centerX) * 6;
      const rotateX = ((y - centerY) / centerY) * -6;
      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    };

    const handleMouseEnter = () => setIsHovered(true);
    const handleMouseLeave = () => {
      card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg)";
      setIsHovered(false);
    };

    card.addEventListener("mousemove", handleMouseMove);
    card.addEventListener("mouseenter", handleMouseEnter);
    card.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      card.removeEventListener("mousemove", handleMouseMove);
      card.removeEventListener("mouseenter", handleMouseEnter);
      card.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  const isCal = variant === "cal";
  const title = isCal ? "Marketing Call" : "Marketing Cadastro";
  const subtitle = isCal
    ? "Leads que contam para Call conforme config por campanha (por origem ou por etiqueta)."
    : "Leads que contam para Cadastro conforme config por campanha (por origem ou por etiqueta).";
  const Icon = isCal ? Calendar : FileEdit;

  const progress = data
    ? data.leadsCount > 0
      ? Math.min(100, Math.round((data.vendasCount / data.leadsCount) * 100))
      : 0
    : 0;
  const circumference = 2 * Math.PI * 20;
  const strokeDashoffset = circumference - (circumference * progress) / 100;

  if (isLoading) {
    return (
      <div className="w-full max-w-lg rounded-2xl p-8 bg-card border border-border shadow-lg flex items-center justify-center min-h-[320px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="w-full max-w-lg rounded-2xl p-8 bg-card border border-border shadow-lg flex flex-col items-center justify-center min-h-[320px] gap-4">
        <Icon className="w-10 h-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Nenhum dado disponível.</p>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className={cn(
        "w-full max-w-lg rounded-2xl p-8 transition-all duration-300 ease-out",
        "bg-card border border-border",
        "shadow-[0_1px_3px_hsl(var(--border)),0_10px_40px_hsl(var(--border)/0.15)]",
        "hover:shadow-[0_1px_3px_hsl(var(--border)),0_20px_60px_hsl(var(--primary)/0.12)]"
      )}
      style={{ transformStyle: "preserve-3d" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold mb-1 text-foreground flex items-center gap-2">
            <Icon className="w-6 h-6 text-primary" />
            {title}
          </h2>
          <p className="text-sm text-muted-foreground max-w-[240px]">{subtitle}</p>
        </div>
        <div className="relative shrink-0">
          <svg width="56" height="56" className="overflow-visible">
            <defs>
              <linearGradient id={`mkt-gradient-${variant}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="hsl(var(--primary))" />
                <stop offset="100%" stopColor="hsl(var(--chart-5))" />
              </linearGradient>
            </defs>
            <circle
              cx="28"
              cy="28"
              r="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              className="text-muted"
            />
            <circle
              cx="28"
              cy="28"
              r="20"
              fill="none"
              stroke={`url(#mkt-gradient-${variant})`}
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-500 -rotate-90 origin-center"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-semibold text-foreground">{progress}%</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <div className="flex relative border-b border-border">
          {TAB_IDS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(
                "flex-1 px-3 py-2 text-sm font-medium transition-colors relative z-10",
                activeTab === tab
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
          <div
            className="absolute bottom-0 h-0.5 bg-gradient-to-r from-primary to-chart-5 transition-all duration-300 ease-in-out"
            style={{
              left: activeTab === "overview" ? "0%" : activeTab === "analytics" ? "33.33%" : "66.66%",
              width: "33.33%",
            }}
          />
        </div>
      </div>

      {/* Tab content */}
      <div className="space-y-4 min-h-[200px]">
        {activeTab === "overview" && (
          <>
            <div className="rounded-lg p-4 border border-border bg-muted/30">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-muted-foreground">Investimento total</span>
                <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">
                  {data.leadsCount} leads
                </span>
              </div>
              <p className="text-2xl font-semibold text-foreground">
                {formatCurrency(data.investimentoReais)}
              </p>
              <div className="mt-3 h-1.5 rounded-full overflow-hidden bg-muted">
                <div
                  className="h-full bg-gradient-to-r from-primary to-chart-5 rounded-full transition-all duration-500"
                  style={{
                    width: isHovered
                      ? `${Math.min(100, (data.comparecimentosCount / Math.max(data.leadsCount, 1)) * 100)}%`
                      : `${Math.min(100, (data.agendamentosCount / Math.max(data.leadsCount, 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Leads", value: String(data.leadsCount), icon: Users },
                { label: "Comparecimentos", value: String(data.comparecimentosCount), icon: Target },
                { label: "Vendas", value: String(data.vendasCount), icon: Trophy },
              ].map((metric) => {
                const IconMetric = metric.icon;
                return (
                  <div
                    key={metric.label}
                    className="rounded-lg p-3 border border-border bg-muted/30"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <IconMetric className="w-3.5 h-3.5 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">{metric.label}</p>
                    </div>
                    <p className="text-lg font-semibold text-foreground">{metric.value}</p>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {activeTab === "analytics" && (
          <div className="space-y-1">
            {[
              { color: "bg-primary", label: "Custo por lead", value: formatCurrency(data.custoPorLead) },
              { color: "bg-blue-500", label: "Custo por agendamento", value: formatCurrency(data.custoPorAgendamento) },
              { color: "bg-amber-500", label: "Custo por comparecimento", value: formatCurrency(data.custoPorComparecimento) },
              { color: "bg-emerald-500", label: "Custo por venda", value: formatCurrency(data.custoPorVenda) },
              { color: "bg-muted-foreground", label: "Propostas (abertas / fechadas)", value: `${data.propostasAbertas} / ${data.propostasFechadas}` },
            ].map((item, index) => (
              <div
                key={item.label}
                className={cn(
                  "flex items-center justify-between py-3",
                  index < 4 && "border-b border-border"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn("w-2 h-2 rounded-full shrink-0", item.color)} />
                  <span className="text-sm text-foreground">{item.label}</span>
                </div>
                <span className="text-sm font-medium text-foreground">{item.value}</span>
              </div>
            ))}
          </div>
        )}

        {activeTab === "reports" && (
          <div className="space-y-4">
            <div className="rounded-lg p-4 border border-border bg-gradient-to-r from-primary/5 to-chart-5/5">
              <h3 className="text-sm font-medium mb-2 text-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                Funil
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground mb-4">
                {data.leadsCount} leads → {data.agendamentosCount} agendamentos → {data.comparecimentosCount} comparecimentos → {data.vendasCount} vendas.
              </p>
              <MktFunnelVisual data={data} variant={variant} />
            </div>
            <div className="rounded-lg p-4 border border-border bg-muted/30">
              <h3 className="text-sm font-medium mb-2 text-foreground flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                Resumo
              </h3>
              <ul className="space-y-2">
                <li className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span>•</span>
                  <span>{data.pctAgendaramVsSóQuiz}</span>
                </li>
                <li className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span>•</span>
                  <span>{data.pctCompareceramVsSóAgendaram}</span>
                </li>
                {data.byFaturamento && Object.keys(data.byFaturamento).length > 0 && isCal && (
                  <li className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span>•</span>
                    <span>Leads por faturamento: {Object.keys(data.byFaturamento).join(", ")}</span>
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onViewDetails();
          }}
          className="flex-1 py-2.5 px-4 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground rounded-lg font-medium text-sm hover:opacity-90 transition-opacity shadow-sm flex items-center justify-center gap-2"
        >
          Ver detalhes
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          type="button"
          className="flex-1 py-2.5 px-4 rounded-lg font-medium text-sm border border-border bg-background text-foreground hover:bg-muted/50 transition-colors flex items-center justify-center gap-2"
        >
          <Download className="w-4 h-4" />
          Exportar
        </button>
      </div>
    </div>
  );
}
