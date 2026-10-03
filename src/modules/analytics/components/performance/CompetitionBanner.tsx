import { memo } from "react";
import { motion } from "framer-motion";
import { Trophy, Clock, Users } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";

interface CompetitionBannerProps {
  name: string;
  criteria: "absolute_value" | "goal_percentage";
  metricType: "sales" | "meetings";
  participantCount: number;
  endDate: string;
  status: "draft" | "active" | "ended";
}

function CompetitionBannerBase({ name, criteria, metricType, participantCount, endDate, status }: CompetitionBannerProps) {
  const end = new Date(endDate);
  const now = new Date();
  const daysLeft = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  const criteriaLabel = criteria === "absolute_value" ? "Valor absoluto" : "% da meta";
  const metricLabel = metricType === "sales" ? "Vendas" : "Reuniões";

  const statusConfig: Record<CompetitionBannerProps["status"], { label: string; variant: BadgeProps["variant"] }> = {
    draft: { label: "Rascunho", variant: "soft" },
    active: { label: "Ativa", variant: "success" },
    ended: { label: "Encerrada", variant: "destructive" },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-card border border-card-border bg-card p-4 text-card-foreground shadow-relevo"
    >
      {/* Ambient glow */}
      {status === "active" && (
        <motion.div
          className="absolute top-0 left-0 w-full h-full"
          animate={{ opacity: [0.05, 0.15, 0.05] }}
          transition={{ repeat: Infinity, duration: 3 }}
          style={{ background: "radial-gradient(ellipse at center, hsl(var(--primary) / 0.2), transparent 70%)" }}
        />
      )}

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground">
            <Trophy className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-bold tracking-[-0.02em]">{name}</h3>
              <Badge variant={statusConfig[status].variant} className="text-[10px]">
                {statusConfig[status].label}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span>{metricLabel} • {criteriaLabel}</span>
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                {participantCount} participantes
              </span>
            </div>
          </div>
        </div>

        {status === "active" && (
          <div className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="font-semibold tabular-nums">
              {daysLeft === 0 ? "Último dia!" : daysLeft === 1 ? "1 dia restante" : `${daysLeft} dias restantes`}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export const CompetitionBanner = memo(CompetitionBannerBase);
