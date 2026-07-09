import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/modules/identity";
import {
  useSupportTicket,
  useSupportTicketComments,
  useCreateSupportTicketComment,
} from "@/modules/platform/hooks/useSupportTickets";
import { useMarkSupportRepliesRead } from "@/modules/platform/hooks/useSupportUnread";
import { STATUS_LABELS } from "@/modules/platform/lib/support-ticket-draft";
import {
  TICKET_AUTHOR_LABELS,
  isFromOrganization,
  ticketMessageAuthor,
  type TicketMessageAuthor,
} from "@/modules/platform/lib/ticket-author";
import { StatusDot } from "./StatusDot";

interface Props {
  ticketId: string;
  onBack: () => void;
}

export function TicketThread({ ticketId, onBack }: Props) {
  const { user } = useAuth();
  const { data: ticket, isLoading } = useSupportTicket(ticketId);
  const { data: comments = [] } = useSupportTicketComments(ticketId);
  const createComment = useCreateSupportTicketComment();
  const markRead = useMarkSupportRepliesRead();
  const [body, setBody] = useState("");

  // Abrir o thread e o ato de ler. Pedir um clique em "marcar como lido" seria
  // pedir ao usuario que confirmasse que leu o que ja esta na tela dele.
  const markReadMutate = markRead.mutate;
  useEffect(() => {
    markReadMutate(ticketId);
  }, [ticketId, markReadMutate]);

  const closed = ticket?.status === "fechado";

  async function handleSend() {
    if (!body.trim()) return;
    try {
      await createComment.mutateAsync({ ticketId, body });
      setBody("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu para enviar.");
    }
  }

  if (isLoading || !ticket) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-border/50 px-6 py-4">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Meus chamados
        </button>
        <h3 className="text-sm font-medium leading-snug text-foreground">{ticket.title}</h3>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
          <StatusDot status={ticket.status} />
          {STATUS_LABELS[ticket.status]}
          <span aria-hidden>·</span>
          {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true, locale: ptBR })}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        {ticket.description && (
          <Bubble
            author={ticketMessageAuthor(ticket.author_user_id, ticket.author_user_id, user?.id)}
            body={ticket.description}
            at={ticket.created_at}
          />
        )}

        {/*
          Comentários internos do staff nunca chegam aqui: a policy de SELECT os
          filtra. Não há nada a esconder nesta lista porque nada a esconder
          chegou até ela.
        */}
        {comments.map((c) => (
          <Bubble
            key={c.id}
            author={ticketMessageAuthor(c.author_user_id, ticket.author_user_id, user?.id)}
            body={c.body}
            at={c.created_at}
          />
        ))}

        {comments.length === 0 && !ticket.description && (
          <p className="pt-6 text-center text-xs text-muted-foreground">
            Ainda não há mensagens neste chamado.
          </p>
        )}
      </div>

      {closed ? (
        <p className="border-t border-border/50 bg-muted/20 px-6 py-4 text-center text-xs text-muted-foreground">
          Este chamado foi fechado. Abra um novo se o problema voltar.
        </p>
      ) : (
        <div className="flex items-end gap-2 border-t border-border/50 bg-muted/20 px-6 py-4">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={2}
            placeholder="Responder…"
            className="resize-none"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!body.trim() || createComment.isPending}
            aria-label="Enviar resposta"
          >
            {createComment.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Send className="h-4 w-4" aria-hidden />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function Bubble({ author, body, at }: { author: TicketMessageAuthor; body: string; at: string }) {
  const fromOrg = isFromOrganization(author);
  return (
    <div className={cn("flex", fromOrg ? "justify-end" : "justify-start")}>
      <div className="max-w-[85%] space-y-1">
        <div
          className={cn(
            "whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
            fromOrg
              ? "rounded-br-sm bg-primary/10 text-foreground"
              : "rounded-bl-sm border border-border/60 bg-muted/30 text-foreground",
          )}
        >
          {body}
        </div>
        <p className={cn("text-[11px] text-muted-foreground", fromOrg ? "text-right" : "text-left")}>
          {TICKET_AUTHOR_LABELS[author]} ·{" "}
          {formatDistanceToNow(new Date(at), { addSuffix: true, locale: ptBR })}
        </p>
      </div>
    </div>
  );
}
