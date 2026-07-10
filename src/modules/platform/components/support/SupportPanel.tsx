import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronRight, Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSupportTickets, type SupportTicket } from "@/modules/platform/hooks/useSupportTickets";
import { useSupportUnread } from "@/modules/platform/hooks/useSupportUnread";
import { STATUS_LABELS } from "@/modules/platform/lib/support-ticket-draft";
import { useHelpArticles, type HelpArticleWithCategory } from "@/modules/platform/hooks/useHelpCenter";
import { HelpArticleDialog } from "@/modules/platform/components/settings/help/HelpArticleDialog";
import { useSupportPanel } from "./SupportPanelContext";
import { HelpSection } from "./HelpSection";
import { NewTicketForm } from "./NewTicketForm";
import { TicketThread } from "./TicketThread";
import { StatusDot } from "./StatusDot";

/**
 * O painel deixou de ser uma gaveta lateral de altura cheia e virou um card
 * flutuante ancorado acima do dock (variante B). É um Radix Dialog — e não um
 * Popover ancorado no FAB — porque o painel abre também pelo Cmd+K, sem clique
 * no botão: o Dialog é autocontido e controlado só pelo `isOpen` do contexto,
 * enquanto o Popover exigiria o anchor montado na mesma árvore. O Dialog dá de
 * graça Esc, clique-fora, focus-trap e retorno de foco. Sem overlay escuro: é um
 * card, não um takeover — o modal já bloqueia a interação atrás dele.
 */
const PANEL_CLASS = cn(
  "fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground",
  "shadow-[0_32px_80px_-12px_rgba(0,0,0,0.85)]",
  // Canto inferior-direito, à esquerda da coluna de FABs, altura limitada.
  "bottom-6 left-auto right-24 w-[392px] max-w-[calc(100vw-1.5rem)] max-h-[min(560px,calc(100vh-7rem))]",
  // Abre com fade + slide curto de baixo.
  "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2 data-[state=closed]:slide-out-to-bottom-2",
  "focus:outline-none",
  // Mobile: quase full-width acima do dock, sem furar a viewport.
  "max-sm:bottom-24 max-sm:left-3 max-sm:right-3 max-sm:w-auto max-sm:max-w-none",
);

export function SupportPanel() {
  const { isOpen, close, ticketId, composing, openNewTicket, openTicket, backToList } =
    useSupportPanel();

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogPrimitive.Portal>
        {/* Sem <Overlay>: o card não escurece o CRM inteiro. O modal já torna o
            fundo inerte e o clique-fora fecha via DismissableLayer. */}
        <DialogPrimitive.Content className={PANEL_CLASS} aria-describedby={undefined}>
          {composing ? (
            <>
              <header className="border-b border-border/60 px-5 pb-3.5 pt-4">
                <DialogPrimitive.Title className="text-[15px] font-semibold tracking-tight">
                  Abrir chamado
                </DialogPrimitive.Title>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Conte o que houve. A gente responde por aqui.
                </p>
              </header>
              <NewTicketForm onCreated={openTicket} onCancel={backToList} />
            </>
          ) : ticketId ? (
            <>
              <DialogPrimitive.Title className="sr-only">Chamado</DialogPrimitive.Title>
              <TicketThread ticketId={ticketId} onBack={backToList} />
            </>
          ) : (
            <TicketList onSelect={openTicket} onNew={openNewTicket} />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function TicketList({
  onSelect,
  onNew,
}: {
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const { data: tickets = [], isLoading } = useSupportTickets();
  const { data: articles = [] } = useHelpArticles();
  const { byTicket: unread } = useSupportUnread();
  const [openArticle, setOpenArticle] = useState<HelpArticleWithCategory | null>(null);

  return (
    <>
      <header className="border-b border-border/60 px-5 pb-3.5 pt-4">
        <DialogPrimitive.Title className="text-[15px] font-semibold tracking-tight">
          Ajuda
        </DialogPrimitive.Title>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Encontre uma resposta ou fale com a gente.
        </p>
      </header>

      {/* Deflexão e chamados dividem o mesmo scroll; header e rodapé ficam fixos. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Deflexão primeiro. O humano vive no rodapé. */}
        <HelpSection onOpenArticle={setOpenArticle} />

        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : tickets.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="flex items-center justify-between px-5 pb-1 pt-4">
              <span className="text-[10.5px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
                Meus chamados
              </span>
              {/* "ver todos" omitido de propósito: a Central de Ajuda (#1042)
                  ainda não expõe uma listagem completa de chamados como destino. */}
            </div>
            <ul className="divide-y divide-border/40">
              {tickets.map((t) => (
                <TicketRow key={t.id} ticket={t} unread={unread[t.id] ?? 0} onSelect={onSelect} />
              ))}
            </ul>
          </>
        )}
      </div>

      <HelpArticleDialog
        article={openArticle}
        articles={articles}
        open={!!openArticle}
        onOpenChange={(open) => !open && setOpenArticle(null)}
        onNavigate={setOpenArticle}
      />

      {/* O humano vive no rodapé, nunca no topo. */}
      <div className="border-t border-border/60 bg-muted/20 px-5 py-3.5">
        <p className="mb-2.5 text-xs text-muted-foreground">Não encontrou o que precisava?</p>
        <Button onClick={onNew} className="w-full font-semibold">
          Abrir chamado
        </Button>
      </div>
    </>
  );
}

function TicketRow({
  ticket,
  unread,
  onSelect,
}: {
  ticket: SupportTicket;
  unread: number;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(ticket.id)}
        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <StatusDot status={ticket.status} className="mt-1.5 self-start" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-snug text-foreground">{ticket.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {STATUS_LABELS[ticket.status]}
            <span aria-hidden> · </span>
            {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true, locale: ptBR })}
          </p>
        </div>
        {unread > 0 ? (
          <span
            aria-label={`${unread} resposta${unread > 1 ? "s" : ""} não lida${unread > 1 ? "s" : ""}`}
            className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground"
          >
            {unread}
          </span>
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />
        )}
      </button>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-8 py-14 text-center">
      <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl border border-border/60 bg-muted/30">
        <Inbox className="h-4 w-4 text-muted-foreground" aria-hidden />
      </div>
      <p className="text-sm font-medium text-foreground">Nenhum chamado por aqui</p>
      <p className="max-w-[26ch] text-xs leading-relaxed text-muted-foreground">
        Quando algo quebrar ou você tiver uma dúvida, abra um chamado e o suporte responde neste
        painel.
      </p>
    </div>
  );
}
