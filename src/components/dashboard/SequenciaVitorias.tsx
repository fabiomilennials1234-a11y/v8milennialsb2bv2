import { memo } from "react";
import { motion } from "framer-motion";
import { Flame, Zap } from "lucide-react";
import { useWinStreak } from "@/hooks/useWinStreak";
import { Skeleton } from "@/components/ui/skeleton";

interface SequenciaVitoriasProps {
  memberId: string | null;
}

function SequenciaVitoriasBase({ memberId }: SequenciaVitoriasProps) {
  const { data, isLoading } = useWinStreak(memberId);

  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (!data) return null;

  const { streak, metricType } = data;
  const label = metricType === "sales" ? "vendas" : "reuniões";
  const isOnFire = streak >= 3;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`relative bg-card rounded-lg border p-5 overflow-hidden group ${
        isOnFire ? "border-primary/40" : "border-border"
      }`}
    >
      <div className={`absolute left-0 top-0 w-[3px] h-full ${
        isOnFire ? "bg-primary" : "bg-muted-foreground/30"
      }`} />
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Sequência de Vitórias
          </p>
          <div className="flex items-baseline gap-2 mt-1.5">
            <p className={`text-2xl font-extrabold tracking-[-0.03em] tabular-nums ${
              isOnFire ? "text-primary" : ""
            }`}>
              {streak} {streak === 1 ? "dia" : "dias"}
            </p>
            <span className="text-xs text-muted-foreground">
              consecutivos com {label}
            </span>
          </div>
        </div>
        <div className={`p-2.5 rounded-lg ${isOnFire ? "bg-primary/10" : "bg-muted"}`}>
          {isOnFire
            ? <Flame className="w-4 h-4 text-primary" />
            : <Zap className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>
    </motion.div>
  );
}

export const SequenciaVitorias = memo(SequenciaVitoriasBase);
