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
  { value: "automation", label: "Automação" },
  { value: "system", label: "Sistema" },
  { value: "pipeline", label: "Pipeline" },
];

const PERIOD_OPTIONS: { value: TimelinePeriod; label: string }[] = [
  { value: "all", label: "Tudo" },
  { value: "today", label: "Hoje" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mês" },
];

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual", agent: "Copilot", automation: "Automação", system: "Sistema",
};

interface LeadDetailTimelineProps {
  leadId: string;
}

export const LeadDetailTimeline = memo(function LeadDetailTimeline({ leadId }: LeadDetailTimelineProps) {
  const timeline = useLeadTimeline(leadId);

  return (
    <div>
      {/* Metrics */}
      {timeline.data?.metrics && timeline.data.metrics.total > 0 && (
        <div className="grid grid-cols-4 gap-1.5 mb-3">
          <div className="rounded-md bg-muted p-2">
            <div className="flex items-center gap-1 mb-0.5">
              <Activity className="w-3 h-3 text-muted-foreground" />
              <span className="text-[9px] text-muted-foreground">Interações</span>
            </div>
            <p className="text-sm font-semibold">{timeline.data.metrics.total}</p>
          </div>
          <div className="rounded-md bg-muted p-2">
            <div className="flex items-center gap-1 mb-0.5">
              <CalendarDays className="w-3 h-3 text-muted-foreground" />
              <span className="text-[9px] text-muted-foreground">Dias</span>
            </div>
            <p className="text-sm font-semibold">{timeline.data.metrics.daysSinceFirstContact}</p>
          </div>
          <div className="rounded-md bg-muted p-2">
            <div className="flex items-center gap-1 mb-0.5">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span className="text-[9px] text-muted-foreground">Último</span>
            </div>
            <p className="text-[10px] font-medium">
              {timeline.data.metrics.lastContact
                ? formatDistanceToNow(new Date(timeline.data.metrics.lastContact), { addSuffix: true, locale: ptBR })
                : "—"}
            </p>
          </div>
          <div className="rounded-md bg-muted p-2">
            <div className="flex items-center gap-1 mb-0.5">
              <BarChart3 className="w-3 h-3 text-muted-foreground" />
              <span className="text-[9px] text-muted-foreground">Top fonte</span>
            </div>
            <p className="text-[10px] font-medium">
              {timeline.data.metrics.topSource
                ? SOURCE_LABELS[timeline.data.metrics.topSource] || timeline.data.metrics.topSource
                : "—"}
            </p>
          </div>
        </div>
      )}

      {/* Source chips */}
      <div className="flex gap-1 mb-2 flex-wrap">
        {SOURCE_FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => timeline.updateFilters({ source: opt.value })}
            className={cn(
              "text-[10px] px-2 py-0.5 rounded-full border transition-colors",
              timeline.filters.source === opt.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:bg-muted"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Period + Search */}
      <div className="flex gap-2 mb-3">
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => timeline.updateFilters({ period: opt.value })}
              className={cn(
                "text-[9px] px-1.5 py-0.5 rounded border transition-colors",
                timeline.filters.period === opt.value
                  ? "bg-muted-foreground/10 text-foreground border-muted-foreground/30"
                  : "text-muted-foreground border-transparent hover:bg-muted"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            value={timeline.filters.search}
            onChange={(e) => timeline.updateFilters({ search: e.target.value })}
            className="h-6 pl-7 text-[10px]"
          />
        </div>
      </div>

      {/* Events */}
      {timeline.isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
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
              className="w-full text-center text-xs text-primary hover:underline py-2"
            >
              Carregar mais ({timeline.data.totalFiltered - timeline.data.events.length} restantes)
            </button>
          )}
        </div>
      ) : (
        <div className="text-center py-6">
          <History className="w-10 h-10 text-muted-foreground/20 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">
            {timeline.filters.source !== "all" || timeline.filters.search
              ? "Nenhum evento neste filtro."
              : "Nenhum histórico."}
          </p>
        </div>
      )}

      {/* Changelog */}
      <div className="mt-4 pt-3 border-t border-border">
        <h3 className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-semibold mb-2 flex items-center gap-1">
          <Edit2 className="w-3 h-3" /> Alterações de campos
        </h3>
        <FieldChangelogTimeline leadId={leadId} limit={20} />
      </div>
    </div>
  );
});
