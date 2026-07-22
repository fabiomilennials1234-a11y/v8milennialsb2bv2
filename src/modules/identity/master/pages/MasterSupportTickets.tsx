/**
 * Console do suporte da Torque — a fila de Chamados, cross-org.
 *
 * O que o staff faz aqui: pega, tria (tipo + severidade), muda o status,
 * responde, e escreve nota interna. O que ele NÃO faz: escrever o relógio.
 * `first_response_at`, `resolved_at`, `awaiting_customer_ms` e `reopen_count`
 * são carimbados pelo banco, e uma tentativa de escrevê-los daqui levanta
 * exceção. Ver a migration `20270117000000_support_ticket_clock.sql`.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bug, CheckCircle2, ChevronDown, ChevronRight, Hand, LifeBuoy, Loader2, RotateCw, Send, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/modules/identity";
import {
  SEVERIDADE_LABELS,
  STATUS_LABELS_STAFF,
  IMPACTO_LABELS,
  TIPO_LABELS,
  type TicketSeveridade,
  type TicketStatus,
  type TicketTipo,
} from "@/modules/platform/lib/support-ticket-draft";
import { isTerminal } from "@/modules/platform/lib/ticket-lifecycle";
import { firstResponseClock } from "@/modules/platform/lib/first-response-clock";
import {
  defectLabel,
  groupByDefect,
  normalizeDefectUrl,
} from "@/modules/platform/lib/defect-url";
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
import { useMasterAuth } from "../hooks/useMasterAuth";
import {
  useClaimSupportTicket,
  useCreateStaffComment,
  useMasterSupportTickets,
  useMasterTicketComments,
  useTriageSupportTicket,
  type MasterSupportTicket,
  type MasterTicketFilters,
} from "../hooks/useMasterSupportTickets";
import { useMasterQueueChannel } from "../hooks/useMasterQueueChannel";
import {
  useMasterSupportUnread,
  useMarkMasterRepliesRead,
} from "../hooks/useMasterSupportUnread";

const ALL = "__all__";

/**
 * O balcão de trabalho é a fila viva; um chamado `resolvido` ou `fechado` já saiu
 * dela. Separá-los tira o ruído do resolvido de cima da fila que ainda pede ação,
 * sem escondê-los — eles descem para um segundo balcão, esverdeado.
 */
const RESOLVED_STATUSES: TicketStatus[] = ["resolvido", "fechado"];
const isResolved = (t: MasterSupportTicket) => RESOLVED_STATUSES.includes(t.status);

const SEVERIDADE_TONE: Record<TicketSeveridade, string> = {
  baixa: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  media: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  alta: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  critica: "bg-red-500/10 text-red-400 border-red-500/20",
};

/**
 * O que o cliente declarou. É o dado a partir do qual o staff *deriva* a
 * severidade — nunca o contrário.
 */
const IMPACTO_TONE: Record<string, string> = {
  parado: "text-red-400",
  contorno: "text-amber-400",
  incomodo: "text-muted-foreground",
};

export default function MasterSupportTickets() {
  const [filters, setFilters] = useState<MasterTicketFilters>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data: tickets, isLoading, refetch, isFetching } = useMasterSupportTickets(filters);
  useMasterQueueChannel(); // new Chamados and claims enter the queue live, no F5
  const { byTicket: unread } = useMasterSupportUnread(); // badge lights when a customer replies

  const hasFilters = Object.values(filters).some(Boolean);

  const active = (tickets ?? []).filter((t) => !isResolved(t));
  const resolved = (tickets ?? []).filter(isResolved);

  const toggle = (id: string) => setExpanded((cur) => (cur === id ? null : id));

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <LifeBuoy className="h-6 w-6 text-primary" aria-hidden />
            Suporte
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Chamados de todas as organizações. Você deriva a severidade; o cliente declara o
            impacto.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RotateCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} aria-hidden />
          Atualizar
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          placeholder="Status"
          value={filters.status}
          options={Object.entries(STATUS_LABELS_STAFF)}
          onChange={(v) => setFilters((f) => ({ ...f, status: v as TicketStatus }))}
        />
        <FilterSelect
          placeholder="Tipo"
          value={filters.tipo}
          options={Object.entries(TIPO_LABELS)}
          onChange={(v) => setFilters((f) => ({ ...f, tipo: v as TicketTipo }))}
        />
        <FilterSelect
          placeholder="Severidade"
          value={filters.severidade}
          options={Object.entries(SEVERIDADE_LABELS)}
          onChange={(v) => setFilters((f) => ({ ...f, severidade: v as TicketSeveridade }))}
        />
        <Button
          variant={filters.unassigned ? "default" : "outline"}
          size="sm"
          onClick={() => setFilters((f) => ({ ...f, unassigned: f.unassigned ? undefined : true }))}
        >
          Sem dono
        </Button>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
            Limpar filtros
          </Button>
        )}
      </div>

      <DefectSummary
        tickets={tickets ?? []}
        active={filters.defectUrl}
        onSelect={(defectUrl) => setFilters((f) => ({ ...f, defectUrl }))}
      />

      <Card>
        <CardContent className="p-0">
          <TicketTable
            tickets={active}
            isLoading={isLoading}
            expanded={expanded}
            onToggle={toggle}
            unread={unread}
            emptyLabel={hasFilters ? "Nenhum chamado com esses filtros." : "A fila está vazia."}
          />
        </CardContent>
      </Card>

      {resolved.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-medium text-emerald-400">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Resolvidos
            <span className="text-xs font-normal text-muted-foreground">
              {resolved.length} chamado{resolved.length > 1 ? "s" : ""}
            </span>
          </h2>
          <Card className="border-emerald-500/20 bg-emerald-500/[0.03]">
            <CardContent className="p-0">
              <TicketTable
                tickets={resolved}
                isLoading={false}
                expanded={expanded}
                onToggle={toggle}
                unread={unread}
                resolved
                emptyLabel=""
              />
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

function TicketTable({
  tickets,
  isLoading,
  expanded,
  onToggle,
  emptyLabel,
  unread,
  resolved = false,
}: {
  tickets: MasterSupportTicket[];
  isLoading: boolean;
  expanded: string | null;
  onToggle: (id: string) => void;
  emptyLabel: string;
  unread?: Record<string, number>;
  resolved?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead>Chamado</TableHead>
          <TableHead className="w-[180px]">Organização</TableHead>
          <TableHead className="w-[130px]">Impacto</TableHead>
          <TableHead className="w-[120px]">Severidade</TableHead>
          <TableHead className="w-[150px]">Status</TableHead>
          <TableHead className="w-[120px]">Dono</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow>
            <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" aria-hidden />
            </TableCell>
          </TableRow>
        ) : !tickets.length ? (
          <TableRow>
            <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
              {emptyLabel}
            </TableCell>
          </TableRow>
        ) : (
          tickets.map((t) => (
            <TicketRow
              key={t.id}
              ticket={t}
              isExpanded={expanded === t.id}
              onToggle={() => onToggle(t.id)}
              unread={unread?.[t.id] ?? 0}
              resolved={resolved}
            />
          ))
        )}
      </TableBody>
    </Table>
  );
}

/**
 * Quantas Organizações distintas estão em cada defeito. É este número — e não o
 * relato de um cliente — que vira Severidade. Aparece só quando há defeito
 * vinculado; um painel sempre visível vira ruído.
 */
function DefectSummary({
  tickets,
  active,
  onSelect,
}: {
  tickets: MasterSupportTicket[];
  active: string | undefined;
  onSelect: (url: string | undefined) => void;
}) {
  const grupos = groupByDefect(tickets);
  if (grupos.length === 0 && !active) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Bug className="h-3.5 w-3.5" aria-hidden />
        Defeitos
      </span>
      {grupos.map((g) => (
        <button
          key={g.defectUrl}
          type="button"
          onClick={() => onSelect(active === g.defectUrl ? undefined : g.defectUrl)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs transition-colors",
            active === g.defectUrl
              ? "border-primary/50 bg-primary/10 text-foreground"
              : "border-border/60 text-muted-foreground hover:bg-muted/40",
          )}
        >
          {defectLabel(g.defectUrl) ?? "defeito"}
          <span className="ml-1.5 text-muted-foreground">
            {g.organizations} org{g.organizations > 1 ? "s" : ""} · {g.tickets} chamado
            {g.tickets > 1 ? "s" : ""}
          </span>
        </button>
      ))}
      {active && (
        <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => onSelect(undefined)}>
          <X className="h-3 w-3" aria-hidden />
          Ver todos
        </Button>
      )}
    </div>
  );
}

function FilterSelect({
  placeholder,
  value,
  options,
  onChange,
}: {
  placeholder: string;
  value: string | undefined;
  options: [string, string][];
  onChange: (v: string | undefined) => void;
}) {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(v) => onChange(v === ALL ? undefined : v)}
    >
      <SelectTrigger className="w-[170px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}: todos</SelectItem>
        {options.map(([key, label]) => (
          <SelectItem key={key} value={key}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TicketRow({
  ticket,
  isExpanded,
  onToggle,
  unread = 0,
  resolved = false,
}: {
  ticket: MasterSupportTicket;
  isExpanded: boolean;
  onToggle: () => void;
  unread?: number;
  resolved?: boolean;
}) {
  const { masterUser } = useMasterAuth();
  const claim = useClaimSupportTicket();
  const triage = useTriageSupportTicket();

  const mine = ticket.assigned_master_user_id === masterUser?.id;

  return (
    <>
      <TableRow
        className={cn(
          "cursor-pointer",
          resolved ? "hover:bg-emerald-500/10" : "hover:bg-accent/40",
        )}
        onClick={onToggle}
      >
        <TableCell>
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <span
                className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                title={`${unread} resposta${unread > 1 ? "s" : ""} não lida${unread > 1 ? "s" : ""} do cliente`}
                aria-label={`${unread} resposta não lida do cliente`}
              >
                {unread}
              </span>
            )}
            <p className="max-w-[380px] truncate text-sm font-medium">{ticket.title}</p>
            {ticket.author_gestor_id && (
              <Badge
                variant="outline"
                className="shrink-0 border-violet-500/30 bg-violet-500/10 text-[10px] font-medium text-violet-400"
              >
                Gestor
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {TIPO_LABELS[ticket.tipo]}
            <span aria-hidden> · </span>
            {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true, locale: ptBR })}
            {ticket.reopen_count > 0 && (
              <span className="ml-2 text-amber-400">reaberto {ticket.reopen_count}×</span>
            )}
            <OverdueTag ticket={ticket} />
          </p>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {ticket.organization?.name ?? "—"}
        </TableCell>
        <TableCell>
          <span className={cn("text-xs", IMPACTO_TONE[ticket.impacto])}>
            {IMPACTO_LABELS[ticket.impacto]}
          </span>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Select
            value={ticket.severidade ?? ALL}
            onValueChange={(v) =>
              triage.mutate(
                { ticketId: ticket.id, severidade: v as TicketSeveridade },
                { onError: () => toast.error("Não deu para definir a severidade.") },
              )
            }
          >
            <SelectTrigger className="h-8 w-[110px] text-xs">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL} disabled>
                Não triado
              </SelectItem>
              {(Object.keys(SEVERIDADE_LABELS) as TicketSeveridade[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {SEVERIDADE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          {/*
            `fechado` nao aparece: o fechamento e automatico, 7 dias apos
            `resolvido`, e o banco recusa um fechamento manual. E um chamado ja
            fechado e terminal — nao ha para onde levá-lo.
          */}
          <Select
            value={ticket.status}
            disabled={isTerminal(ticket.status)}
            onValueChange={(v) =>
              triage.mutate(
                { ticketId: ticket.id, status: v as TicketStatus },
                { onError: () => toast.error("Não deu para mudar o status.") },
              )
            }
          >
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS_LABELS_STAFF) as TicketStatus[])
                .filter((s) => !isTerminal(s) || ticket.status === s)
                .map((s) => (
                  <SelectItem key={s} value={s} disabled={isTerminal(s)}>
                    {STATUS_LABELS_STAFF[s]}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          {ticket.assigned_master_user_id ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => claim.mutate({ ticketId: ticket.id, masterUserId: null })}
            >
              {mine ? "Você · soltar" : "Devolver à fila"}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => claim.mutate({ ticketId: ticket.id })}
            >
              <Hand className="h-3.5 w-3.5" aria-hidden />
              Pegar
            </Button>
          )}
        </TableCell>
      </TableRow>

      {isExpanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={7} className={cn("p-0", resolved ? "bg-emerald-500/[0.04]" : "bg-muted/20")}>
            <TicketDetail ticket={ticket} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

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
function OverdueTag({ ticket }: { ticket: MasterSupportTicket }) {
  const clock = useTicketClock(ticket);
  if (clock.responded || !clock.isOverdue) return null;
  return <span className="ml-2 font-medium text-red-400">atrasado</span>;
}

function TicketDetail({ ticket }: { ticket: MasterSupportTicket }) {
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
      toast.error(err instanceof Error ? err.message : "Não deu para enviar.");
    }
  }

  const porComentario = groupByComment(attachments);
  const capacidade = draftAttachmentCapacity(attachments, files.length);

  return (
    <div className="grid gap-6 px-6 py-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        {ticket.description && (
          <div className="space-y-2 rounded-lg border border-border/50 bg-background/50 p-3">
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
                "rounded-lg border p-3 text-sm",
                c.is_internal
                  ? "border-amber-500/30 bg-amber-500/5"
                  : "border-border/50 bg-background/50",
              )}
            >
              {c.is_internal && (
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-amber-500">
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
            className={cn("resize-none", isInternal && "border-amber-500/40")}
          />
          <AttachmentPicker
            files={files}
            onChange={setFiles}
            disabled={createComment.isPending || upload.isPending || !capacidade.ok}
            remaining={ATTACHMENTS_PER_TICKET - attachments.length - files.length}
            label={isInternal ? "Anexar à nota" : "Anexar"}
          />
          {isInternal && files.length > 0 && (
            <p className="text-[11px] text-amber-500">
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
              className={cn("text-xs", isInternal && "bg-amber-500 text-black hover:bg-amber-500/90")}
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
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
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
            <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Erros no browser dele
            </h4>
            <ul className="space-y-1">
              {clientErrors.slice(-5).map((e, i) => (
                <li
                  key={i}
                  className="rounded border border-border/50 bg-background/50 p-2 font-mono text-[11px] leading-relaxed"
                >
                  <span className="text-red-400">{e.name}</span> {e.message}
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
      <dd className={cn("min-w-0 flex-1", clock.isOverdue && "font-medium text-red-400")}>
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
      { onError: () => toast.error("Não deu para vincular o defeito.") },
    );
  }

  return (
    <div className="space-y-1.5">
      <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
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
