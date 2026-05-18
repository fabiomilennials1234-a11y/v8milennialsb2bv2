/**
 * ChatSkeleton — placeholder estrutural para a rota /chat-whatsapp.
 *
 * Pintado imediatamente enquanto o chunk JS é baixado ou enquanto as
 * queries iniciais (`whatsapp_instances_for_user`, `whatsapp_contacts`)
 * carregam pela primeira vez. Mantém o layout 2-painéis (lista + janela)
 * para evitar reflow quando o conteúdo real chega.
 *
 * Critério: não usar o `<TorqueLoader />` (loader genérico de Suspense)
 * para esta rota — o vendedor abre o chat dezenas de vezes ao dia; um
 * skeleton estrutural percebe-se como "já está aberto" em vez de "ainda
 * está carregando".
 */
import { cn } from "@/lib/utils";

const shimmer =
  "relative overflow-hidden bg-muted/40 before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.6s_infinite] before:bg-gradient-to-r before:from-transparent before:via-foreground/5 before:to-transparent";

function Bar({ className }: { className?: string }) {
  return <div className={cn("h-3 rounded-md", shimmer, className)} />;
}

function ContactRowSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3">
      <div className={cn("w-10 h-10 rounded-full shrink-0", shimmer)} />
      <div className="flex-1 min-w-0 space-y-2">
        <Bar className="w-3/4 h-3" />
        <Bar className="w-1/2 h-2.5 opacity-70" />
      </div>
    </div>
  );
}

function MessageBubbleSkeleton({ outgoing }: { outgoing?: boolean }) {
  return (
    <div className={cn("flex w-full mt-3", outgoing ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "h-12 rounded-2xl",
          outgoing ? "w-[55%] rounded-br-sm bg-bubble-outgoing/60" : "w-[60%] rounded-bl-sm bg-bubble-incoming/60",
          shimmer,
        )}
      />
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <div
      role="status"
      aria-label="Carregando conversa"
      aria-busy="true"
      className="flex flex-1 min-h-0 rounded-lg border bg-background overflow-hidden"
    >
      {/* Sidebar — lista de conversas */}
      <div className="w-full md:w-80 lg:w-96 flex-shrink-0 min-h-0 flex flex-col overflow-hidden border-r border-border/60">
        <div className="p-3 border-b border-border/60 space-y-3">
          <Bar className="w-1/2 h-4" />
          <Bar className="w-full h-9 rounded-lg" />
        </div>
        <div className="flex-1 overflow-hidden">
          {Array.from({ length: 7 }).map((_, i) => (
            <ContactRowSkeleton key={i} />
          ))}
        </div>
      </div>

      {/* Janela de mensagens */}
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex-col hidden md:flex">
        {/* Header */}
        <div className="flex items-center gap-3 p-3 border-b border-border/60">
          <div className={cn("w-9 h-9 rounded-full shrink-0", shimmer)} />
          <div className="flex-1 min-w-0 space-y-2">
            <Bar className="w-40 h-3.5" />
            <Bar className="w-24 h-2.5 opacity-70" />
          </div>
        </div>

        {/* Lista de mensagens */}
        <div className="flex-1 min-h-0 overflow-hidden px-4 py-3">
          <MessageBubbleSkeleton />
          <MessageBubbleSkeleton outgoing />
          <MessageBubbleSkeleton />
          <MessageBubbleSkeleton outgoing />
          <MessageBubbleSkeleton />
        </div>

        {/* Composer */}
        <div className="p-3 border-t border-border/60">
          <Bar className="h-10 w-full rounded-full" />
        </div>
      </div>

      <span className="sr-only">Carregando conversa…</span>
    </div>
  );
}
