import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronRight, Headset, Inbox, Loader2, Send } from "lucide-react";
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
      {/* Home "Intercom": header em gradiente com a presença da equipe, uma
          pergunta grande e o humano ancorado no rodapé. Reskin visual — mesmos
          dados, mesmos handlers. */}
      <header className="relative overflow-hidden px-6 pb-6 pt-5">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/25 via-primary/10 to-transparent"
        />
        <div
          aria-hidden
          className="absolute -right-10 -top-16 -z-10 h-48 w-48 rounded-full bg-primary/20 blur-3xl"
        />
        <div className="flex items-center gap-1.5">
          {/* Avatares empilhados: presença da equipe, decorativos. */}
          <div className="flex -space-x-2" aria-hidden>
            {["S", "U", "P"].map((c) => (
              <span
                key={c}
                className="grid h-7 w-7 place-items-center rounded-full border-2 border-card bg-muted text-[11px] font-semibold text-foreground"
              >
                {c}
              </span>
            ))}
          </div>
          {/* Presença honesta: SEM métrica fabricada. `useSlaConfigs()` só expõe
              SLA de pipeline (lead/estágio), não um alvo de primeira-resposta do
              suporte — derivar um "~X min" daí seria inventar número. Copy
              estática, sem promessa quantificada (padrão do CTO). */}
          <span className="ml-1 text-xs text-muted-foreground">
            Equipe de suporte · respondemos rápido
          </span>
        </div>
        <DialogPrimitive.Title className="mt-4 text-2xl font-semibold leading-tight tracking-tight text-foreground">
          Precisa de ajuda?
        </DialogPrimitive.Title>
        <p className="mt-1 text-[15px] leading-snug text-muted-foreground">
          Encontre uma resposta ou fale com a equipe.
        </p>
      </header>

      {/* Deflexão e chamados dividem o mesmo scroll; header e rodapé ficam fixos. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-4">
        {/* Busca grande + deflexão de artigos. A HelpSection é a unidade de
            busca real (some quando não há artigo publicado); não a fragmentamos
            para não fabricar um campo de busca que não filtra. */}
        <HelpSection onOpenArticle={setOpenArticle} />

        {/* Continuar conversa — os chamados recentes, com retomada visível. */}
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : tickets.length === 0 ? (
          <EmptyState />
        ) : (
          <section className="px-4">
            <h2 className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Continuar conversa
            </h2>
            {/* "ver todos" omitido de propósito: a Central de Ajuda (#1042)
                ainda não expõe uma listagem completa de chamados como destino. */}
            <ul className="space-y-1.5">
              {tickets.map((t) => (
                <TicketRow key={t.id} ticket={t} unread={unread[t.id] ?? 0} onSelect={onSelect} />
              ))}
            </ul>
          </section>
        )}
      </div>

      <HelpArticleDialog
        article={openArticle}
        articles={articles}
        open={!!openArticle}
        onOpenChange={(open) => !open && setOpenArticle(null)}
        onNavigate={setOpenArticle}
      />

      {/* CTA fixo — o humano vive no rodapé, nunca no topo. */}
      <div className="border-t border-border/60 bg-background/60 p-4">
        <Button
          onClick={onNew}
          className="flex w-full items-center justify-center gap-2 py-6 text-sm font-semibold shadow-lg shadow-primary/20"
        >
          <Send className="h-4 w-4" aria-hidden />
          Enviar mensagem
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
        className="group flex w-full items-center gap-3 rounded-xl border border-border/60 bg-background/40 p-3 text-left transition hover:border-border hover:bg-muted/40"
      >
        {/* Avatar do suporte com o status do chamado sobreposto. */}
        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <Headset className="h-4 w-4" aria-hidden />
          <StatusDot
            status={ticket.status}
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 border-2 border-card"
          />
        </span>
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
            className="grid h-5 min-w-[20px] shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground"
          >
            {unread}
          </span>
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition group-hover:translate-x-0.5" aria-hidden />
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
