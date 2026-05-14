import { memo } from "react";
import { Activity, CalendarDays, Clock, BarChart3, Search, History, Edit2, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TimelineItem } from "@/components/leads/TimelineItem";
import { FieldChangelogTimeline } from "@/components/leads/FieldChangelogTimeline";
import { useLeadTimeline } from "@/hooks/useLeadTimeline";
import type { TimelineSource, TimelinePeriod } from "@/hooks/useLeadTimeline";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const SOURCE_FILTER_OPTIONS: { value: TimelineSource | "all" | "pipeline"; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "manual", label: "Manual" },
  { value: "agent", label: "Copilot" },
  { value: "automation", label: "Automacao" },
  { value: "system", label: "Sistema" },
  { value: "pipeline", label: "Pipeline" },
];

const PERIOD_OPTIONS: { value: TimelinePeriod; label: string }[] = [
  { value: "all", label: "Tudo" },
  { value: "today", label: "Hoje" },
  { value: "week", label: "7d" },
  { value: "month", label: "30d" },
];

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual", agent: "Copilot", automation: "Automacao", system: "Sistema",
};

interface LeadDetailTimelineProps {
  leadId: string;
}

export const LeadDetailTimeline = memo(function LeadDetailTimeline({ leadId }: LeadDetailTimelineProps) {
  const timeline = useLeadTimeline(leadId);

  return (
    <div className="space-y-4">
      {/* Metrics */}
      {timeline.data?.metrics && timeline.data.metrics.total > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { icon: Activity, label: "Interacoes", value: String(timeline.data.metrics.total), color: "text-amber-500" },
            { icon: CalendarDays, label: "Dias", value: String(timeline.data.metrics.daysSinceFirstContact), color: "text-blue-400" },
            {
              icon: Clock, label: "Ultimo",
              value: timeline.data.metrics.lastContact
                ? formatDistanceToNow(new Date(timeline.data.metrics.lastContact), { addSuffix: false, locale: ptBR })
                : "--",
              color: "text-emerald-400",
            },
            {
              icon: BarChart3, label: "Top fonte",
              value: timeline.data.metrics.topSource
                ? SOURCE_LABELS[timeline.data.metrics.topSource] || timeline.data.metrics.topSource
                : "--",
              color: "text-purple-400",
            },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="rounded-lg bg-muted/40 border border-border/30 p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={cn("w-3 h-3", color)} />
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-medium">{label}</span>
              </div>
              <p className="text-sm font-semibold tracking-tight">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters row */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {SOURCE_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => timeline.updateFilters({ source: opt.value })}
              className={cn(
                "text-[10px] px-2.5 py-1 rounded-md font-medium transition-all",
                timeline.filters.source === opt.value
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {opt.label}
            </button>
          ))}
          <div className="w-px h-4 bg-border/50 mx-0.5" />
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => timeline.updateFilters({ period: opt.value })}
              className={cn(
                "text-[10px] px-2 py-1 rounded-md font-medium transition-all",
                timeline.filters.period === opt.value
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground/50 hover:text-muted-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <Input
            placeholder="Buscar na timeline..."
            value={timeline.filters.search}
            onChange={(e) => timeline.updateFilters({ search: e.target.value })}
            className="h-8 pl-8 text-xs bg-muted/30 border-border/30 focus-visible:bg-background"
          />
        </div>
      </div>

      {/* Events */}
      {timeline.isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40" />
        </div>
      ) : timeline.data && timeline.data.events.length > 0 ? (
        <div className="space-y-0">
          {timeline.data.events.map((event, index) => (
            <TimelineItem
              key={event.id}
              event={event}
              isLast={index === timeline.data!.events.length - 1 && !timeline.data!.hasMore}
            />
          ))}
          {timeline.data.hasMore && (
            <button
              onClick={timeline.loadMore}
              className="w-full text-center text-[11px] font-medium text-primary/80 hover:text-primary py-3 transition-colors"
            >
              Carregar mais ({timeline.data.totalFiltered - timeline.data.events.length} restantes)
            </button>
          )}
        </div>
      ) : (
        <div className="text-center py-10">
          <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
            <History className="w-5 h-5 text-muted-foreground/30" />
          </div>
          <p className="text-xs text-muted-foreground/60">
            {timeline.filters.source !== "all" || timeline.filters.search
              ? "Nenhum evento neste filtro."
              : "Nenhum historico registrado."}
          </p>
        </div>
      )}

      {/* Changelog */}
      <div className="pt-4 border-t border-border/30">
        <h3 className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-semibold mb-3 flex items-center gap-1.5">
          <Edit2 className="w-3 h-3" /> Alteracoes de campos
        </h3>
        <FieldChangelogTimeline leadId={leadId} limit={20} />
      </div>
    </div>
  );
});
