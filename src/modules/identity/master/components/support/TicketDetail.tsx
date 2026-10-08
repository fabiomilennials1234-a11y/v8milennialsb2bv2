/**
 * A gaveta de um Chamado no console do suporte: diagnóstico, conversa com o
 * cliente, nota interna, anexos e o contexto capturado na abertura.
 *
 * Saiu da antiga tela de Suporte (lista) quando ela virou o kanban da
 * Operação — o conteúdo do chamado é o mesmo, só mudou o recipiente.
 *
 * O que o staff NÃO faz aqui: escrever o relógio. `first_response_at`,
 * `resolved_at`, `awaiting_customer_ms` e `reopen_count` são carimbados pelo
 * banco (`enforce_support_ticket_write_rules`).
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/modules/identity";
import { SEVERIDADE_LABELS } from "@/modules/platform/lib/support-ticket-draft";
import { firstResponseClock } from "@/modules/platform/lib/first-response-clock";
import { defectLabel, normalizeDefectUrl } from "@/modules/platform/lib/defect-url";
// Cross-module passa pelo barrel: `@/modules/platform`, nunca caminho interno.
import {
  ATTACHMENTS_PER_TICKET,
  AttachmentGallery,
  AttachmentPicker,
  draftAttachmentCapacity,
  groupByComment,
  uploadAll,
  useTicketAttachments,
  useUploadTicketAttachment,
} from "@/modules/platform";
import { useTicketChannel } from "@/modules/platform/hooks/useTicketChannel";
import {
  useCreateStaffComment,
  useMasterTicketComments,
  useTriageSupportTicket,
  type MasterSupportTicket,
} from "../../hooks/useMasterSupportTickets";
import { useMarkMasterRepliesRead } from "../../hooks/useMasterSupportUnread";
import { TicketDiagnosisPanel } from "./TicketDiagnosisPanel";
import { notifyError } from "@/shared/errors";
import { SEVERIDADE_TONE } from "../../lib/ticket-tones";


/**
 * O relógio de primeira resposta. A meta é política, não SLA — nada foi
 * prometido a ninguém. E o tempo em `aguardando_cliente` é descontado: sem isso,
 * um chamado em que o cliente sumiu por uma semana apareceria como "staff
 * demorou 7 dias".
 */
function useTicketClock(ticket: MasterSupportTicket) {
  return firstResponseClock({
    severidade: ticket.severidade,
    createdAt: new Date(ticket.created_at),
    firstResponseAt: ticket.first_response_at ? new Date(ticket.first_response_at) : null,
    awaitingCustomerMs: Number(ticket.awaiting_customer_ms ?? 0),
    awaitingSince: ticket.awaiting_since ? new Date(ticket.awaiting_since) : null,
    now: new Date(),
  });
}

/** Só aparece quando há meta e ela estourou. Um selo que sempre aparece não é sinal. */
export function OverdueTag({ ticket }: { ticket: MasterSupportTicket }) {
  const clock = useTicketClock(ticket);
  if (clock.responded || !clock.isOverdue) return null;
  return <span className="ml-2 font-medium text-destructive">atrasado</span>;
}

export function TicketDetail({ ticket }: { ticket: MasterSupportTicket }) {
  const { user } = useAuth();
  const { data: comments = [] } = useMasterTicketComments(ticket.id);
  useTicketChannel(ticket.id); // customer's reply lands live while the thread is open
  const createComment = useCreateStaffComment();
  const { data: attachments = [] } = useTicketAttachments(ticket.id);
  const upload = useUploadTicketAttachment();
  const [body, setBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  // Opening the Chamado is the act of reading it — clear its unread badge.
  const markRead = useMarkMasterRepliesRead();
  const markReadMutate = markRead.mutate;
  useEffect(() => {
    markReadMutate(ticket.id);
  }, [ticket.id, markReadMutate]);

  const ctx = (ticket.support_context ?? {}) as Record<string, unknown>;
  const clientErrors = (ctx.client_errors ?? []) as { name: string; message: string; at: string }[];

  async function send() {
    if (!body.trim() || !user?.id) return;
    const anexos = files;
    // A visibilidade do anexo é a do comentário que ele acompanha, e ela é
    // gravada no caminho do arquivo — por isso é lida aqui, no envio, e nunca
    // muda depois (ADR-0022, 6).
    const interno = isInternal;
    try {
      const comment = await createComment.mutateAsync({
        ticketId: ticket.id,
        body,
        isInternal: interno,
        authorUserId: user.id,
      });
      setBody("");
      setFiles([]);

      const falhas = await uploadAll(upload.mutateAsync, anexos, {
        ticketId: ticket.id,
        commentId: comment.id,
        internal: interno,
      });
      if (falhas.length > 0) {
        toast.error(`Não deu para anexar: ${falhas.join(", ")}.`);
      }
    } catch (err) {
      notifyError(err, { fallback: "Não deu para enviar." });
    }
  }

  const porComentario = groupByComment(attachments);
  const capacidade = draftAttachmentCapacity(attachments, files.length);

  return (
    <div className="grid gap-6 px-6 py-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        {/* Etapa 4 do processo de fix: responder o cliente e executar o prompt. */}
        <TicketDiagnosisPanel
          ticketId={ticket.id}
          comments={comments}
          onUseReply={(text) => {
            setIsInternal(false);
            setBody(text);
          }}
        />

        {ticket.description && (
          <div className="space-y-2 rounded-xl border border-border/50 bg-background/50 p-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{ticket.description}</p>
            {/* O que o cliente anexou ao abrir: pertence ao Chamado, não a um
                turno da conversa. */}
            <AttachmentGallery
              attachments={porComentario.get(null) ?? []}
              canDelete
              ticketId={ticket.id}
            />
          </div>
        )}

        <div className="space-y-3">
          {comments.map((c) => (
            <div
              key={c.id}
              className={cn(
                "rounded-xl border p-3 text-sm",
                c.is_internal
                  ? "border-warning/40 bg-warning/10"
                  : "border-border/50 bg-background/50",
              )}
            >
              {c.is_internal && (
                <p className="mb-1 text-[11px] font-bold uppercase tracking-[.06em] text-warning-strong">
                  Nota interna · o cliente não vê
                </p>
              )}
              <p className="whitespace-pre-wrap leading-relaxed">{c.body}</p>
              <AttachmentGallery
                attachments={porComentario.get(c.id) ?? []}
                className="mt-2"
                canDelete
                ticketId={ticket.id}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {formatDistanceToNow(new Date(c.created_at), { addSuffix: true, locale: ptBR })}
              </p>
            </div>
          ))}
          {comments.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhuma mensagem ainda.</p>
          )}
        </div>

        <div className="space-y-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder={isInternal ? "Nota interna (o cliente não vê)…" : "Responder ao cliente…"}
            className={cn("resize-none", isInternal && "border-warning/40")}
          />
          <AttachmentPicker
            files={files}
            onChange={setFiles}
            disabled={createComment.isPending || upload.isPending || !capacidade.ok}
            remaining={ATTACHMENTS_PER_TICKET - attachments.length - files.length}
            label={isInternal ? "Anexar à nota" : "Anexar"}
          />
          {isInternal && files.length > 0 && (
            <p className="text-[11px] text-warning-strong">
              Estes arquivos entram como nota interna — o cliente não os vê.
            </p>
          )}
          {!capacidade.ok && (
            <p className="text-[11px] text-muted-foreground">{capacidade.reason}</p>
          )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={isInternal ? "default" : "outline"}
              size="sm"
              onClick={() => setIsInternal((v) => !v)}
              className={cn("text-xs", isInternal && "bg-warning text-warning-foreground shadow-none hover:bg-warning/90")}
            >
              Nota interna
            </Button>
            <Button
              size="sm"
              className="ml-auto gap-1.5"
              onClick={send}
              disabled={!body.trim() || createComment.isPending || upload.isPending}
            >
              {createComment.isPending || upload.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Send className="h-3.5 w-3.5" aria-hidden />
              )}
              Enviar
            </Button>
          </div>
        </div>
      </div>

      {/* Support Context — a evidência que o cliente não teve que reproduzir. */}
      <aside className="space-y-3 text-xs">
        <h3 className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
          Contexto capturado
        </h3>
        <dl className="space-y-1.5">
          <ContextRow label="Rota" value={String(ctx.route ?? "—")} mono />
          <ContextRow label="Versão" value={String(ctx.app_version ?? "—")} mono />
          <ContextRow label="Sessão" value={String(ctx.session_id ?? "—")} mono />
          <ContextRow
            label="Aberto em"
            value={format(new Date(ticket.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
          />
          <ClockRow ticket={ticket} />
        </dl>

        {ticket.severidade && (
          <Badge variant="outline" className={cn("text-[11px]", SEVERIDADE_TONE[ticket.severidade])}>
            {SEVERIDADE_LABELS[ticket.severidade]}
          </Badge>
        )}

        <DefectField ticket={ticket} />

        {clientErrors.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
              Erros no browser dele
            </h4>
            <ul className="space-y-1">
              {clientErrors.slice(-5).map((e, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-border/50 bg-background/50 p-2 font-mono text-[11px] leading-relaxed"
                >
                  <span className="text-destructive">{e.name}</span> {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

function ClockRow({ ticket }: { ticket: MasterSupportTicket }) {
  const clock = useTicketClock(ticket);

  if (clock.responded) {
    return (
      <ContextRow
        label="1ª resposta"
        value={`${formatDistanceToNow(new Date(ticket.first_response_at!), {
          addSuffix: true,
          locale: ptBR,
        })}${clock.isOverdue ? " · fora da meta" : ""}`}
      />
    );
  }

  if (!clock.deadline) {
    return <ContextRow label="1ª resposta" value="sem meta — falta triar" />;
  }

  return (
    <div className="flex gap-2">
      <dt className="w-[76px] shrink-0 text-muted-foreground">Responder</dt>
      <dd className={cn("min-w-0 flex-1", clock.isOverdue && "font-medium text-destructive")}>
        {clock.isOverdue ? "atrasado desde " : "até "}
        {format(clock.deadline, "dd/MM HH:mm", { locale: ptBR })}
      </dd>
    </div>
  );
}

/**
 * O defeito vive no GitHub. Aqui só o link — contar chamados por ele é o que
 * torna a Severidade uma medida.
 */
function DefectField({ ticket }: { ticket: MasterSupportTicket }) {
  const triage = useTriageSupportTicket();
  const [value, setValue] = useState(ticket.defect_url ?? "");
  const [error, setError] = useState<string | null>(null);

  function save() {
    const parsed = normalizeDefectUrl(value);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    setError(null);
    if (parsed.url === (ticket.defect_url ?? null)) return;

    triage.mutate(
      { ticketId: ticket.id, defect_url: parsed.url },
      { onError: (caught: unknown) => notifyError(caught, { fallback: "Não deu para vincular o defeito." }) },
    );
  }

  return (
    <div className="space-y-1.5">
      <h4 className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
        Defeito (GitHub)
      </h4>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder="https://github.com/…/issues/123"
        aria-label="Link da issue do GitHub"
        aria-invalid={!!error}
        className="h-8 text-xs"
      />
      {error && (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      )}
      {ticket.defect_url && !error && (
        <a
          href={ticket.defect_url}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-[11px] text-primary underline-offset-2 hover:underline"
        >
          {defectLabel(ticket.defect_url)}
        </a>
      )}
    </div>
  );
}

function ContextRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-[76px] shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 flex-1 truncate", mono && "font-mono text-[11px]")}>{value}</dd>
    </div>
  );
}
