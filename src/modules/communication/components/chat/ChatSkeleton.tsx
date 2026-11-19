/**
 * ChatSkeleton — o ÚNICO esqueleto da rota /chat-whatsapp, do chunk até a lista.
 *
 * Pintado pelo Suspense enquanto o chunk JS baixa (App.tsx) e, com a MESMA
 * forma, pelo shell enquanto caixas e a primeira página de conversas chegam
 * (`ChatShellWithContext`). Antes disso o shell trocava o esqueleto por um
 * Loader2 de tela cheia no meio do caminho — dois estados de espera para uma
 * única espera (régua de espera, CP-v2).
 *
 * Mantém o layout 2-painéis (lista + janela) para o conteúdo real entrar sem
 * reflow. Ossos V5 (`Osso`): tokens, e o brilho some com reduced-motion.
 *
 * `frase` entra aos 1 s pela régua (`Espera`): texto fixo, sem dado do usuário.
 */
import { cn } from "@/lib/utils";
import { Espera, Osso } from "@/shared/espera";

function ContactRowSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3">
      <Osso className="h-10 w-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Osso className="h-3 w-3/4" />
        <Osso className="h-2.5 w-1/2 opacity-70" />
      </div>
    </div>
  );
}

/** As linhas da lista de conversas — a forma que a lista usa na própria espera. */
export function ListaDeConversasSkeleton({ linhas = 7 }: { linhas?: number }) {
  return (
    <div>
      {Array.from({ length: linhas }).map((_, i) => (
        <ContactRowSkeleton key={i} />
      ))}
    </div>
  );
}

function MessageBubbleSkeleton({ outgoing }: { outgoing?: boolean }) {
  return (
    <div className={cn("mt-3 flex w-full", outgoing ? "justify-end" : "justify-start")}>
      <Osso
        className={cn(
          "h-12 rounded-2xl",
          outgoing ? "w-[55%] rounded-br-sm" : "w-[60%] rounded-bl-sm",
        )}
      />
    </div>
  );
}

/**
 * As bolhas da thread — a forma do painel da conversa enquanto as mensagens
 * chegam (mesma forma da janela no esqueleto da rota).
 */
export function ThreadDeMensagensSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden px-4 py-3">
      <MessageBubbleSkeleton />
      <MessageBubbleSkeleton outgoing />
      <MessageBubbleSkeleton />
      <MessageBubbleSkeleton outgoing />
      <MessageBubbleSkeleton />
    </div>
  );
}

export function ChatSkeleton({ frase }: { frase?: string } = {}) {
  return (
    // Grupo ocupado com nome, e não `role="status"`: quem ANUNCIA é a região
    // viva da frase (dentro da `Espera`). Duas regiões vivas aninhadas, mais
    // um texto sr-only, faziam o leitor de tela repetir a espera.
    <div
      role="group"
      aria-label="Carregando conversa"
      aria-busy="true"
      className="relative flex flex-1 min-h-0 overflow-hidden rounded-lg border bg-background"
    >
      {/* Sidebar — lista de conversas */}
      <div className="flex min-h-0 w-full flex-shrink-0 flex-col overflow-hidden border-r border-border/60 md:w-80 lg:w-96">
        <div className="space-y-3 border-b border-border/60 p-3">
          <Osso className="h-4 w-1/2" />
          <Osso className="h-9 w-full rounded-lg" />
        </div>
        <div className="flex-1 overflow-hidden">
          <ListaDeConversasSkeleton />
        </div>
      </div>

      {/* Janela de mensagens */}
      <div className="hidden min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex">
        <div className="flex items-center gap-3 border-b border-border/60 p-3">
          <Osso className="h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Osso className="h-3.5 w-40" />
            <Osso className="h-2.5 w-24 opacity-70" />
          </div>
        </div>

        <ThreadDeMensagensSkeleton />

        <div className="border-t border-border/60 p-3">
          <Osso className="h-10 w-full rounded-full" />
        </div>
      </div>

      {/* Só a frase vem da régua: a forma acima já está na tela desde o
          primeiro quadro (é o fallback do Suspense), então não passa pelo
          "invisível < 100 ms" — esconder um esqueleto já visível piscaria. */}
      {frase && (
        <Espera carregando forma={null} frase={frase} className="pointer-events-none absolute inset-0">
          {null}
        </Espera>
      )}
    </div>
  );
}
