import { memo } from "react";
import { motion } from "framer-motion";
import { Trophy, Clock, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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

  const statusConfig = {
    draft: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
    active: { label: "Ativa", color: "bg-success/20 text-success" },
    ended: { label: "Encerrada", color: "bg-destructive/20 text-destructive" },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 p-4"
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
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Trophy className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">{name}</h3>
              <Badge className={`text-[10px] ${statusConfig[status].color}`}>
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
            <span className="font-medium">
              {daysLeft === 0 ? "Último dia!" : daysLeft === 1 ? "1 dia restante" : `${daysLeft} dias restantes`}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export const CompetitionBanner = memo(CompetitionBannerBase);
