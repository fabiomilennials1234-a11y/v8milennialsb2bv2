import { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { useStaleLeads } from "@/hooks/useStaleLeads";
import { Skeleton } from "@/components/ui/skeleton";

interface LeadsParadosProps {
  memberId?: string | null;
}

function LeadsParadosBase({ memberId }: LeadsParadosProps) {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading } = useStaleLeads({ memberId });

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!data || data.summary.total === 0) return null;

  const { summary, leads } = data;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="relative bg-card rounded-lg border border-destructive/30 p-5 overflow-hidden"
    >
      <div className="absolute left-0 top-0 w-[3px] h-full bg-destructive/60" />
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {memberId ? "Leads Aguardando Ação" : "Leads Parados"}
          </p>
          <div className="flex items-baseline gap-3 mt-1.5">
            <p className="text-2xl font-extrabold tracking-[-0.03em] tabular-nums text-destructive">
              {summary.total}
            </p>
            <div className="flex gap-2 text-xs">
              {summary.critical > 0 && (
                <span className="text-destructive font-semibold">{summary.critical} críticos</span>
              )}
              {summary.warning > 0 && (
                <span className="text-yellow-400 font-semibold">{summary.warning} atenção</span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-2.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
        >
          {expanded
            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-3 space-y-1.5 overflow-hidden"
          >
            {leads.slice(0, 10).map((lead) => (
              <div
                key={lead.id}
                className="flex items-center justify-between text-sm py-1.5 px-2 rounded bg-muted/50"
              >
                <span className="truncate font-medium">
                  {lead.name}
                  {lead.company_name && (
                    <span className="text-muted-foreground ml-1">— {lead.company_name}</span>
                  )}
                </span>
                <span className={`text-xs font-semibold tabular-nums ${lead.days_inactive >= 14 ? "text-destructive" : "text-yellow-400"}`}>
                  {lead.days_inactive}d
                </span>
              </div>
            ))}
            {leads.length > 10 && (
              <p className="text-xs text-muted-foreground text-center pt-1">
                +{leads.length - 10} leads
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export const LeadsParados = memo(LeadsParadosBase);
