/**
 * Console do suporte da Torque — a fila de Chamados, cross-org.
 *
 * O que o staff faz aqui: pega, tria (tipo + severidade), muda o status,
 * responde, e escreve nota interna. O que ele NÃO faz: escrever o relógio.
 * `first_response_at`, `resolved_at`, `awaiting_customer_ms` e `reopen_count`
 * são carimbados pelo banco, e uma tentativa de escrevê-los daqui levanta
 * exceção. Ver a migration `20270117000000_support_ticket_clock.sql`.
 */

import { useState } from "react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronDown, ChevronRight, Hand, LifeBuoy, Loader2, RotateCw, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
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

const ALL = "__all__";

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

  const hasFilters = Object.values(filters).some(Boolean);

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

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[620px]">
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
                ) : !tickets?.length ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      {hasFilters ? "Nenhum chamado com esses filtros." : "A fila está vazia."}
                    </TableCell>
                  </TableRow>
                ) : (
                  tickets.map((t) => (
                    <TicketRow
                      key={t.id}
                      ticket={t}
                      isExpanded={expanded === t.id}
                      onToggle={() => setExpanded(expanded === t.id ? null : t.id)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
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
}: {
  ticket: MasterSupportTicket;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { masterUser } = useMasterAuth();
  const claim = useClaimSupportTicket();
  const triage = useTriageSupportTicket();

  const mine = ticket.assigned_master_user_id === masterUser?.id;

  return (
    <>
      <TableRow className="cursor-pointer hover:bg-accent/40" onClick={onToggle}>
        <TableCell>
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
        </TableCell>
        <TableCell>
          <p className="max-w-[380px] truncate text-sm font-medium">{ticket.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {TIPO_LABELS[ticket.tipo]}
            <span aria-hidden> · </span>
            {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true, locale: ptBR })}
            {ticket.reopen_count > 0 && (
              <span className="ml-2 text-amber-400">reaberto {ticket.reopen_count}×</span>
            )}
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
          <Select
            value={ticket.status}
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
              {(Object.keys(STATUS_LABELS_STAFF) as TicketStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
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
          <TableCell colSpan={7} className="bg-muted/20 p-0">
            <TicketDetail ticket={ticket} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function TicketDetail({ ticket }: { ticket: MasterSupportTicket }) {
  const { user } = useAuth();
  const { data: comments = [] } = useMasterTicketComments(ticket.id);
  const createComment = useCreateStaffComment();
  const [body, setBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);

  const ctx = (ticket.support_context ?? {}) as Record<string, unknown>;
  const clientErrors = (ctx.client_errors ?? []) as { name: string; message: string; at: string }[];

  async function send() {
    if (!body.trim() || !user?.id) return;
    try {
      await createComment.mutateAsync({
        ticketId: ticket.id,
        body,
        isInternal,
        authorUserId: user.id,
      });
      setBody("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu para enviar.");
    }
  }

  return (
    <div className="grid gap-6 px-6 py-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        {ticket.description && (
          <p className="whitespace-pre-wrap rounded-lg border border-border/50 bg-background/50 p-3 text-sm leading-relaxed">
            {ticket.description}
          </p>
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
              disabled={!body.trim() || createComment.isPending}
            >
              {createComment.isPending ? (
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
          <ContextRow
            label="1ª resposta"
            value={
              ticket.first_response_at
                ? formatDistanceToNow(new Date(ticket.first_response_at), {
                    addSuffix: true,
                    locale: ptBR,
                  })
                : "ainda não"
            }
          />
        </dl>

        {ticket.severidade && (
          <Badge variant="outline" className={cn("text-[11px]", SEVERIDADE_TONE[ticket.severidade])}>
            {SEVERIDADE_LABELS[ticket.severidade]}
          </Badge>
        )}

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

function ContextRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-[76px] shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 flex-1 truncate", mono && "font-mono text-[11px]")}>{value}</dd>
    </div>
  );
}
