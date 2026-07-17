import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, Loader2, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/modules/identity";
import {
  useSupportTicket,
  useSupportTicketComments,
  useCreateSupportTicketComment,
  useReopenSupportTicket,
} from "@/modules/platform/hooks/useSupportTickets";
import { useMarkSupportRepliesRead } from "@/modules/platform/hooks/useSupportUnread";
import { useTicketChannel } from "@/modules/platform/hooks/useTicketChannel";
import { STATUS_LABELS } from "@/modules/platform/lib/support-ticket-draft";
import {
  TICKET_AUTHOR_LABELS,
  isFromOrganization,
  ticketMessageAuthor,
  type TicketMessageAuthor,
} from "@/modules/platform/lib/ticket-author";
import { StatusDot } from "./StatusDot";
import { AttachmentStrip } from "./AttachmentStrip";

interface Props {
  ticketId: string;
  onBack: () => void;
}

export function TicketThread({ ticketId, onBack }: Props) {
  const { user } = useAuth();
  const { data: ticket, isLoading } = useSupportTicket(ticketId);
  const { data: comments = [] } = useSupportTicketComments(ticketId);
  useTicketChannel(ticketId); // master's reply lands live, no refresh
  const createComment = useCreateSupportTicketComment();
  const markRead = useMarkSupportRepliesRead();
  const reopen = useReopenSupportTicket();
  const [body, setBody] = useState("");

  // Abrir o thread e o ato de ler. Pedir um clique em "marcar como lido" seria
  // pedir ao usuario que confirmasse que leu o que ja esta na tela dele.
  const markReadMutate = markRead.mutate;
  useEffect(() => {
    markReadMutate(ticketId);
  }, [ticketId, markReadMutate]);

  // O painel do cliente jamais mostra nota interna, seja quem for que o abra.
  const publicComments = comments.filter((c) => !c.is_internal);

  const closed = ticket?.status === "fechado";
  const resolved = ticket?.status === "resolvido";

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
            author={ticketMessageAuthor(false, ticket.author_user_id, user?.id)}
            body={ticket.description}
            at={ticket.created_at}
          />
        )}

        {/*
          Notas internas nunca aparecem no painel do cliente. A policy de SELECT
          já as esconde do cliente real, mas o staff usa este mesmo painel (seu
          próprio chamado, shadow mode) e para ele a policy as entrega — então o
          filtro mora AQUI também. A regra do banco protege; esta protege a
          experiência.
        */}
        {publicComments.map((c) => (
          <Bubble
            key={c.id}
            author={ticketMessageAuthor(c.from_staff, c.author_user_id, user?.id)}
            body={c.body}
            at={c.created_at}
          />
        ))}

        {publicComments.length === 0 && !ticket.description && (
          <p className="pt-6 text-center text-xs text-muted-foreground">
            Ainda não há mensagens neste chamado.
          </p>
        )}

        <AttachmentStrip ticketId={ticketId} canAttach={!closed} />
      </div>

      {closed ? (
        <p className="border-t border-border/50 bg-muted/20 px-6 py-4 text-center text-xs text-muted-foreground">
          Este chamado foi fechado. Abra um novo se o problema voltar.
        </p>
      ) : resolved ? (
        /* Sete dias de silêncio confirmam o conserto. Enquanto isso, reabrir é
           a única transição que o cliente pode fazer. */
        <div className="space-y-2 border-t border-border/50 bg-muted/20 px-6 py-4 text-center">
          <p className="text-xs text-muted-foreground">
            O suporte marcou este chamado como resolvido. Ele fecha sozinho em 7 dias.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            disabled={reopen.isPending}
            onClick={() =>
              reopen.mutate(ticketId, {
                onError: () => toast.error("Não deu para reabrir o chamado."),
              })
            }
          >
            {reopen.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            )}
            O problema voltou — reabrir
          </Button>
        </div>
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
