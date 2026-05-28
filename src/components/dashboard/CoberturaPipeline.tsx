import { memo } from "react";
import { motion } from "framer-motion";
import { Target } from "lucide-react";
import { usePipelineCoverage } from "@/hooks/usePipelineCoverage";
import { Skeleton } from "@/components/ui/skeleton";

interface CoberturaPipelineProps {
  month: number;
  year: number;
  memberId?: string | null;
}

const STATUS_STYLES = {
  healthy: "text-success border-success/30",
  warning: "text-yellow-400 border-yellow-400/30",
  critical: "text-destructive border-destructive/30",
  "no-goal": "text-muted-foreground border-border",
} as const;

function CoberturaPipelineBase({ month, year, memberId }: CoberturaPipelineProps) {
  const { data, isLoading } = usePipelineCoverage({ month, year, memberId });

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!data) return null;

  const style = STATUS_STYLES[data.status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`relative bg-card rounded-lg border p-5 overflow-hidden group ${style}`}
    >
      <div className="absolute left-0 top-0 w-[3px] h-full bg-current opacity-60" />
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Cobertura de Pipeline
          </p>
          <div className="flex items-baseline gap-2 mt-1.5">
            <p className="text-2xl font-extrabold tracking-[-0.03em] tabular-nums">
              {data.label}
            </p>
            {data.status === "no-goal" && (
              <span className="text-xs text-muted-foreground">
                Configure sua meta em Gestão de Metas
              </span>
            )}
          </div>
        </div>
        <div className="p-2.5 rounded-lg bg-muted">
          <Target className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>
    </motion.div>
  );
}

export const CoberturaPipeline = memo(CoberturaPipelineBase);
