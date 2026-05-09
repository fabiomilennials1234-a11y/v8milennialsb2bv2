/**
 * DealInsightsCard — health score gauge + factors + suggestions for a deal.
 * Consumes useDealInsight.
 */

import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Lightbulb,
  AlertTriangle,
  Shield,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDealInsight, type RiskLevel } from "@/hooks/useDealInsights";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────

interface DealInsightsCardProps {
  dealId: string | null;
  compact?: boolean;
}

// ── Risk config ───────────────────────────────────────────────

const RISK_CONFIG: Record<RiskLevel, { label: string; color: string; bgColor: string; borderColor: string }> = {
  low: { label: "Baixo", color: "text-emerald-500", bgColor: "bg-emerald-500/10", borderColor: "border-emerald-500/20" },
  medium: { label: "Medio", color: "text-amber-500", bgColor: "bg-amber-500/10", borderColor: "border-amber-500/20" },
  high: { label: "Alto", color: "text-orange-500", bgColor: "bg-orange-500/10", borderColor: "border-orange-500/20" },
  critical: { label: "Critico", color: "text-red-500", bgColor: "bg-red-500/10", borderColor: "border-red-500/20" },
};

// ── Gauge component ───────────────────────────────────────────

function HealthGauge({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 40;
  const progress = (score / 100) * circumference;
  const color =
    score >= 70 ? "stroke-emerald-500" : score >= 40 ? "stroke-amber-500" : "stroke-red-500";

  return (
    <div className="relative w-24 h-24 mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/30" />
        <motion.circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          className={color}
          initial={{ strokeDasharray: circumference, strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - progress }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold">{score}</span>
        <span className="text-[10px] text-muted-foreground">saude</span>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────

export function DealInsightsCard({ dealId, compact = false }: DealInsightsCardProps) {
  const { data: insight, isLoading } = useDealInsight(dealId);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-4">
          <Skeleton className="h-24 w-24 rounded-full mx-auto" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (!insight) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-6">
            <Activity className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Nenhum insight disponivel para este negocio.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const risk = RISK_CONFIG[insight.risk_level];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Saude do Negocio
          </span>
          <Badge
            variant="outline"
            className={cn("text-xs", risk.color, risk.bgColor, risk.borderColor)}
          >
            <AlertTriangle className="w-3 h-3 mr-1" />
            Risco {risk.label}
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <HealthGauge score={insight.health_score} />

        {insight.predicted_close_probability != null && (
          <div className="text-center">
            <span className="text-xs text-muted-foreground">
              Probabilidade de fechamento:{" "}
              <span className="font-semibold text-foreground">
                {Math.round(insight.predicted_close_probability * 100)}%
              </span>
            </span>
          </div>
        )}

        {!compact && (
          <>
            {/* Positive factors */}
            {insight.positive_factors.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-emerald-500" />
                  Fatores positivos
                </p>
                <ul className="space-y-1">
                  {insight.positive_factors.map((f, i) => (
                    <li key={i} className="text-sm text-emerald-600 dark:text-emerald-400 flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Negative factors */}
            {insight.negative_factors.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1">
                  <TrendingDown className="w-3 h-3 text-red-500" />
                  Fatores negativos
                </p>
                <ul className="space-y-1">
                  {insight.negative_factors.map((f, i) => (
                    <li key={i} className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Suggestions */}
            {insight.suggestions.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1">
                  <Lightbulb className="w-3 h-3 text-amber-500" />
                  Sugestoes
                </p>
                <ul className="space-y-1">
                  {insight.suggestions.map((s, i) => (
                    <li key={i} className="text-sm flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
