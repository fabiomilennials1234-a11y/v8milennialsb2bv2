import { memo, useMemo, useState } from "react";
import { History, Loader2, Search, MessageSquare } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TimelineItem } from "@/components/leads/TimelineItem";
import { useLeadTimeline, type TimelineSource } from "@/hooks/useLeadTimeline";
import { useLeadComments } from "../../hooks/useLeadComments";
import { CommentItem } from "./CommentItem";
import { cn } from "@/lib/utils";

type FilterTab = "all" | "comments" | TimelineSource | "pipeline";

const FILTERS: { value: FilterTab; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "comments", label: "Comentários" },
  { value: "manual", label: "Manual" },
  { value: "agent", label: "Copilot" },
  { value: "automation", label: "Automação" },
  { value: "system", label: "Sistema" },
  { value: "pipeline", label: "Pipeline" },
];

interface ActivityFeedProps {
  leadId: string;
}

export const ActivityFeed = memo(function ActivityFeed({ leadId }: ActivityFeedProps) {
  const timeline = useLeadTimeline(leadId);
  const comments = useLeadComments(leadId);
  const [filter, setFilter] = useState<FilterTab>("all");

  const merged = useMemo(() => {
    const tlEvents = (timeline.data?.events ?? [])
      // filtra comment_added/comment_deleted da timeline pra não duplicar
      .filter((e) => e.action !== "comment_added" && e.action !== "comment_deleted")
      .map((e) => ({ kind: "event" as const, created_at: e.created_at, payload: e }));
    const cm = (comments.data ?? []).map((c) => ({
      kind: "comment" as const,
      created_at: c.created_at,
      payload: c,
    }));
    return [...tlEvents, ...cm].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [timeline.data, comments.data]);

  const visible = useMemo(() => {
    if (filter === "all") return merged;
    if (filter === "comments") return merged.filter((m) => m.kind === "comment");
    return merged.filter((m) => m.kind === "event" && (
      filter === "pipeline" ? true : m.payload.source === filter
    ));
  }, [merged, filter]);

  const loading = timeline.isLoading || comments.isLoading;
  const isEmpty = !loading && visible.length === 0;

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <div className="flex items-center gap-1 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "text-[10px] px-2.5 py-1 rounded-full font-medium transition-all border",
              filter === f.value
                ? "bg-foreground text-background border-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent hover:border-border/60"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 pointer-events-none" />
        <Input
          placeholder="Buscar na timeline..."
          value={timeline.filters.search}
          onChange={(e) => timeline.updateFilters({ search: e.target.value })}
          className="h-8 pl-8 text-xs bg-muted/30 border-border/30 focus-visible:bg-background"
        />
      </div>

      <div className="space-y-3 overflow-y-auto pr-1">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40" />
          </div>
        )}
        {isEmpty && (
          <div className="text-center py-10">
            <div className="w-12 h-12 rounded-full bg-muted/40 flex items-center justify-center mx-auto mb-3">
              {filter === "comments" ? (
                <MessageSquare className="w-5 h-5 text-muted-foreground/30" />
              ) : (
                <History className="w-5 h-5 text-muted-foreground/30" />
              )}
            </div>
            <p className="text-xs text-muted-foreground/60">
              {filter === "comments" ? "Nenhum comentário ainda." : "Nada por aqui."}
            </p>
            {filter === "comments" && (
              <p className="text-[10px] text-muted-foreground/40 mt-1">
                Comentários acompanham o lead em toda jornada.
              </p>
            )}
          </div>
        )}
        {visible.map((m, idx) => {
          if (m.kind === "comment") {
            return <CommentItem key={`c-${m.payload.id}`} comment={m.payload} leadId={leadId} />;
          }
          return (
            <TimelineItem
              key={`e-${m.payload.id}`}
              event={m.payload}
              isLast={idx === visible.length - 1}
            />
          );
        })}
      </div>
    </div>
  );
});
