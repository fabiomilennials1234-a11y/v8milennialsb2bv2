/**
 * DealsAtRiskPanel — lists high/critical risk deals.
 * Consumes useDealsAtRisk.
 */

import { motion } from "framer-motion";
import {
  AlertTriangle,
  TrendingDown,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDealsAtRisk, type RiskLevel } from "@/hooks/useDealInsights";
import { useOrganization } from "@/hooks/useOrganization";
import { cn } from "@/lib/utils";

// ── Risk styling ──────────────────────────────────────────────

const RISK_STYLES: Record<RiskLevel, { label: string; className: string }> = {
  low: { label: "Baixo", className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  medium: { label: "Medio", className: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  high: { label: "Alto", className: "bg-orange-500/10 text-orange-500 border-orange-500/20" },
  critical: { label: "Critico", className: "bg-red-500/10 text-red-500 border-red-500/20" },
};

// ── Component ─────────────────────────────────────────────────

export function DealsAtRiskPanel() {
  const { organizationId } = useOrganization();
  const { data: deals = [], isLoading } = useDealsAtRisk(organizationId ?? null);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            Negocios em Risco
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (deals.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-muted-foreground" />
            Negocios em Risco
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <TrendingDown className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Nenhum negocio em risco detectado.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            Negocios em Risco
          </span>
          <Badge variant="outline" className="text-xs font-normal">
            {deals.length} {deals.length === 1 ? "negocio" : "negocios"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          {deals.map((deal, idx) => {
            const risk = RISK_STYLES[deal.risk_level];
            return (
              <motion.div
                key={deal.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
              >
                {/* Health score circle */}
                <div className="relative w-10 h-10 shrink-0">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/30" />
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      strokeWidth="3"
                      strokeLinecap="round"
                      className={deal.health_score >= 40 ? "stroke-amber-500" : "stroke-red-500"}
                      strokeDasharray={`${(deal.health_score / 100) * 88} 88`}
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
                    {deal.health_score}
                  </span>
                </div>

                {/* Deal info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">Deal #{deal.deal_id.slice(0, 8)}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="outline" className={cn("text-[10px]", risk.className)}>
                      {risk.label}
                    </Badge>
                    {deal.negative_factors.length > 0 && (
                      <span className="text-[10px] text-muted-foreground truncate">
                        {deal.negative_factors[0]}
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
