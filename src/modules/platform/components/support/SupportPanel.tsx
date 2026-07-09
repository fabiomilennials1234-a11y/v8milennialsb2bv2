import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronRight, LifeBuoy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useSupportTickets, type SupportTicket } from "@/modules/platform/hooks/useSupportTickets";
import { STATUS_LABELS } from "@/modules/platform/lib/support-ticket-draft";
import { useHelpArticles, type HelpArticleWithCategory } from "@/modules/platform/hooks/useHelpCenter";
import { HelpArticleDialog } from "@/modules/platform/components/settings/help/HelpArticleDialog";
import { useSupportPanel } from "./SupportPanelContext";
import { HelpSection } from "./HelpSection";
import { NewTicketForm } from "./NewTicketForm";
import { TicketThread } from "./TicketThread";
import { StatusDot } from "./StatusDot";

export function SupportPanel() {
  const { isOpen, close, ticketId, composing, openNewTicket, openTicket, backToList } =
    useSupportPanel();

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[440px]">
        {composing ? (
          <>
            <SheetHeader className="border-b border-border/50 px-6 pb-4 pt-6 text-left">
              <SheetTitle className="text-base font-semibold">Abrir chamado</SheetTitle>
              <SheetDescription className="text-xs">
                Conte o que houve. A gente responde por aqui.
              </SheetDescription>
            </SheetHeader>
            <NewTicketForm onCreated={openTicket} onCancel={backToList} />
          </>
        ) : ticketId ? (
          <>
            <SheetHeader className="sr-only">
              <SheetTitle>Chamado</SheetTitle>
            </SheetHeader>
            <TicketThread ticketId={ticketId} onBack={backToList} />
          </>
        ) : (
          <TicketList onSelect={openTicket} onNew={openNewTicket} />
        )}
      </SheetContent>
    </Sheet>
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
  const [openArticle, setOpenArticle] = useState<HelpArticleWithCategory | null>(null);

  return (
    <>
      <SheetHeader className="border-b border-border/50 px-6 pb-4 pt-6 text-left">
        <SheetTitle className="text-base font-semibold">Ajuda</SheetTitle>
        <SheetDescription className="text-xs">
          Procure uma resposta ou fale com o suporte da Torque.
        </SheetDescription>
      </SheetHeader>

      {/* Deflexão primeiro. O humano vive no rodapé. */}
      <HelpSection onOpenArticle={setOpenArticle} />

      <HelpArticleDialog
        article={openArticle}
        articles={articles}
        open={!!openArticle}
        onOpenChange={(open) => !open && setOpenArticle(null)}
        onNavigate={setOpenArticle}
      />

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : tickets.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-border/40">
            {tickets.map((t) => (
              <TicketRow key={t.id} ticket={t} onSelect={onSelect} />
            ))}
          </ul>
        )}
      </div>

      {/* O humano vive no rodapé, nunca no topo. */}
      <div className="border-t border-border/50 bg-muted/20 px-6 py-4">
        <p className="mb-2.5 text-xs text-muted-foreground">Não encontrou o que precisava?</p>
        <Button onClick={onNew} className="w-full gap-2">
          <LifeBuoy className="h-4 w-4" aria-hidden />
          Abrir chamado
        </Button>
      </div>
    </>
  );
}

function TicketRow({
  ticket,
  onSelect,
}: {
  ticket: SupportTicket;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(ticket.id)}
        className="flex w-full items-center gap-3 px-6 py-3.5 text-left transition-colors hover:bg-muted/40"
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
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />
      </button>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 py-16 text-center">
      <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl border border-border/60 bg-muted/30">
        <LifeBuoy className="h-4 w-4 text-muted-foreground" aria-hidden />
      </div>
      <p className="text-sm font-medium text-foreground">Nenhum chamado por aqui</p>
      <p className="max-w-[26ch] text-xs leading-relaxed text-muted-foreground">
        Quando algo quebrar ou você tiver uma dúvida, abra um chamado e o suporte responde neste
        painel.
      </p>
    </div>
  );
}
