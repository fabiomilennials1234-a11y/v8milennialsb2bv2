/**
 * ContextPanelTabHistory — aba HISTÓRICO do ContextPanel.
 *
 * Timeline completa do lead (todas as ações registradas em lead_history):
 *   - scroll vertical com paginação (load more)
 *   - filtros omitidos por espaço — ficha completa tem versão full
 *   - TimelineItem compact com expand inline
 */
import { History, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TimelineItem } from "@/components/leads/TimelineItem";
import { useLeadTimeline } from "@/hooks/useLeadTimeline";

export interface ContextPanelTabHistoryProps {
  leadId: string | null;
}

export function ContextPanelTabHistory({ leadId }: ContextPanelTabHistoryProps) {
  const { data, isLoading, loadMore, page } = useLeadTimeline(leadId ?? undefined);

  if (!leadId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-6 text-center">
        <History className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Nenhum lead vinculado</p>
      </div>
    );
  }

  if (isLoading && page === 1) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Carregando" />
      </div>
    );
  }

  const events = data?.events ?? [];
  const hasMore = data?.hasMore ?? false;

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-6 text-center">
        <History className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Nenhum evento registrado</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-2 pr-2">
        {events.map((item, index) => (
          <TimelineItem
            key={item.id}
            event={item}
            isLast={index === events.length - 1}
            compact
          />
        ))}
        {hasMore && (
          <div className="px-4 py-2">
            <Button
              onClick={loadMore}
              variant="outline"
              size="sm"
              className="w-full h-7 text-[11.5px]"
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : null}
              Carregar mais
            </Button>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
