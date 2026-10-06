/**
 * Operação — o centro da Área Dev. Todo Chamado num kanban, do aberto ao
 * concluído (board "Área Dev: 18 telas → 5 centrais", regras OP-1…OP-10).
 *
 * Substitui a antiga lista de Suporte. O conteúdo do chamado (diagnóstico,
 * conversa, anexos, contexto) é o mesmo — mora na gaveta (`TicketDetail`).
 * A coluna vem do dado (`lib/operacao-kanban.ts`); arrastar pede o fato ao
 * banco e o trigger tem a última palavra.
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowRight,
  Bug,
  CircleDollarSign,
  Hand,
  Hourglass,
  Loader2,
  MessageSquareReply,
  RotateCw,
  Stethoscope,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { KpiRow, KpiTile, ValueUnit } from "@/components/ui/bento";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  IMPACTO_LABELS,
  SEVERIDADE_LABELS,
  STATUS_LABELS_STAFF,
  TIPO_LABELS,
  type TicketSeveridade,
} from "@/modules/platform/lib/support-ticket-draft";
import { defectLabel, groupByDefect } from "@/modules/platform/lib/defect-url";
import { notifyError } from "@/shared/errors";
import { MasterPageHeader } from "../../components/MasterPageHeader";
import { MasterKanban, type KanbanColumnDef } from "../../components/MasterKanban";
import { OverdueTag, TicketDetail } from "../../components/support/TicketDetail";
import { SEVERIDADE_TONE } from "../../lib/ticket-tones";
import { useMasterAuth } from "../../hooks/useMasterAuth";
import {
  useClaimSupportTicket,
  useMasterDiagnosisDigests,
  useMasterSupportTickets,
  useMoveOperacaoTicket,
  useTriageSupportTicket,
  type MasterSupportTicket,
  type TicketDiagnosisDigest,
} from "../../hooks/useMasterSupportTickets";
import { useMasterQueueChannel } from "../../hooks/useMasterQueueChannel";
import { useMasterSupportUnread } from "../../hooks/useMasterSupportUnread";
import { COMPLEXITY_LABELS, KIND_LABELS, type DiagnosisComplexity, type DiagnosisKind } from "../../lib/ticket-diagnosis";
import {
  OPERACAO_COLUMNS,
  OPERACAO_COLUMN_HINTS,
  OPERACAO_COLUMN_LABELS,
  canMove,
  columnOf,
  groupByColumn,
  isReopenAlert,
  type OperacaoColumn,
} from "../../lib/operacao-kanban";

const ALL = "__all__";

const COLUMNS: KanbanColumnDef<OperacaoColumn>[] = OPERACAO_COLUMNS.map((id) => ({
  id,
  label: OPERACAO_COLUMN_LABELS[id],
  hint: OPERACAO_COLUMN_HINTS[id],
}));

/** O próximo passo natural de cada coluna — o botão da gaveta, para quem não arrasta. */
const NEXT_COLUMN: Partial<Record<OperacaoColumn, OperacaoColumn>> = {
  diagnostico: "andamento",
  andamento: "aguardando",
  aguardando: "andamento",
};

const MOVE_LABELS = {
  pegar: "Pegar e começar",
  enviar_resposta: "Enviar resposta ao cliente",
  retomar: "Retomar — o cliente respondeu",
} as const;

// Custo do Claude Code é em dólar; o número segue o formato daqui (US$ 1,80).
const usd = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const usdNumero = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Filters {
  severidade?: TicketSeveridade;
  semDono?: boolean;
  meus?: boolean;
  defectUrl?: string;
}

export default function OperacaoCentral() {
  const { masterUser } = useMasterAuth();
  const { data: tickets = [], isLoading, refetch, isFetching } = useMasterSupportTickets();
  useMasterQueueChannel(); // chamado novo e "peguei" entram ao vivo
  const { byTicket: unread } = useMasterSupportUnread();
  const { data: digests = new Map<string, TicketDiagnosisDigest>() } = useMasterDiagnosisDigests(
    tickets.map((t) => t.id),
  );
  const move = useMoveOperacaoTicket();

  const [filters, setFilters] = useState<Filters>({});
  // `?chamado=<id>` abre a gaveta direto — links da ficha da org.
  const [params, setParams] = useSearchParams();
  const openId = params.get("chamado");
  const setOpenId = (id: string | null) =>
    setParams(
      (p) => {
        if (id) p.set("chamado", id);
        else p.delete("chamado");
        return p;
      },
      { replace: true },
    );

  const visible = useMemo(
    () =>
      tickets.filter(
        (t) =>
          (!filters.severidade || t.severidade === filters.severidade) &&
          (!filters.semDono || !t.assigned_master_user_id) &&
          (!filters.meus || t.assigned_master_user_id === masterUser?.id) &&
          (!filters.defectUrl || t.defect_url === filters.defectUrl),
      ),
    [tickets, filters, masterUser?.id],
  );
  const grouped = useMemo(() => groupByColumn(visible, digests), [visible, digests]);
  const kpis = useMemo(() => summarize(tickets, digests), [tickets, digests]);
  const defeitos = useMemo(() => groupByDefect(tickets), [tickets]);
  const open = tickets.find((t) => t.id === openId) ?? null;
  const hasFilters = Object.values(filters).some(Boolean);

  function doMove(ticket: MasterSupportTicket, to: OperacaoColumn) {
    const verdict = canMove(ticket, digests.get(ticket.id) ?? null, to);
    if (!verdict.ok) {
      toast.error(verdict.reason);
      return;
    }
    move.mutate(
      { ticketId: ticket.id, move: verdict.move.kind },
      {
        onSuccess: () =>
          toast.success(
            verdict.move.kind === "enviar_resposta"
              ? "Resposta enviada. O chamado fecha sozinho em 7 dias se o cliente não reabrir."
              : "Chamado em andamento.",
          ),
        onError: (e: unknown) => notifyError(e, { fallback: "O banco recusou o movimento." }),
      },
    );
  }

  return (
    <div className="space-y-5">
      <MasterPageHeader
        title="Operação"
        subtitle="Todo chamado num kanban, do aberto ao concluído. A coluna vem do dado — arrastar pede o próximo passo."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RotateCw className={cn("h-4 w-4", isFetching && "animate-spin")} aria-hidden />
            Atualizar
          </Button>
        }
      />

      <KpiRow cols={4}>
        <KpiTile
          label="Sem diagnóstico"
          value={kpis.semDiagnostico}
          icon={Stethoscope}
          tone={kpis.semDiagnostico > 0 ? "warn" : "neutral"}
          note={kpis.parados > 0 ? `${kpis.parados} com cliente parado` : "nenhum cliente parado"}
          loading={isLoading}
        />
        <KpiTile
          label="Em andamento"
          value={kpis.andamento}
          icon={Hand}
          tone="info"
          note={`${kpis.semDono} sem dono na fila`}
          loading={isLoading}
        />
        <KpiTile
          label="Reabertos 3× ou mais"
          value={kpis.reabertos}
          icon={AlertTriangle}
          tone={kpis.reabertos > 0 ? "bad" : "good"}
          note={kpis.reabertos > 0 ? "a correção não pegou" : "nenhuma correção falhou"}
          loading={isLoading}
        />
        <KpiTile
          label="Custo real no mês"
          value={
            <>
              <ValueUnit className="ml-0 mr-1">US$</ValueUnit>
              {usdNumero(kpis.custoReal)}
            </>
          }
          icon={CircleDollarSign}
          tone="gold"
          note={`estimado ${usd(kpis.custoEstimado)} · ${kpis.executados} execuções`}
          loading={isLoading}
        />
      </KpiRow>

      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 scrollbar-hide sm:mx-0 sm:flex-wrap sm:px-0">
        <Select
          value={filters.severidade ?? ALL}
          onValueChange={(v) => setFilters((f) => ({ ...f, severidade: v === ALL ? undefined : (v as TicketSeveridade) }))}
        >
          <SelectTrigger className="h-9 w-[170px] shrink-0" aria-label="Severidade">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Toda severidade</SelectItem>
            {(Object.keys(SEVERIDADE_LABELS) as TicketSeveridade[]).map((s) => (
              <SelectItem key={s} value={s}>
                {SEVERIDADE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={filters.semDono ? "ink" : "outline"}
          size="sm"
          className="shrink-0"
          aria-pressed={!!filters.semDono}
          onClick={() => setFilters((f) => ({ ...f, semDono: !f.semDono || undefined, meus: undefined }))}
        >
          Sem dono
        </Button>
        <Button
          variant={filters.meus ? "ink" : "outline"}
          size="sm"
          className="shrink-0"
          aria-pressed={!!filters.meus}
          onClick={() => setFilters((f) => ({ ...f, meus: !f.meus || undefined, semDono: undefined }))}
        >
          Meus
        </Button>
        {defeitos.map((g) => (
          <Button
            key={g.defectUrl}
            variant={filters.defectUrl === g.defectUrl ? "ink" : "outline"}
            size="sm"
            className="shrink-0 gap-1.5"
            aria-pressed={filters.defectUrl === g.defectUrl}
            onClick={() =>
              setFilters((f) => ({ ...f, defectUrl: f.defectUrl === g.defectUrl ? undefined : g.defectUrl }))
            }
          >
            <Bug className="h-3.5 w-3.5" aria-hidden />
            {defectLabel(g.defectUrl) ?? "defeito"}
            <span className="font-medium opacity-70">
              {g.organizations} org{g.organizations > 1 ? "s" : ""}
            </span>
          </Button>
        ))}
        {hasFilters && (
          <Button variant="ghost" size="sm" className="shrink-0 gap-1" onClick={() => setFilters({})}>
            <X className="h-3.5 w-3.5" aria-hidden />
            Limpar
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid place-items-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-label="Carregando chamados" />
        </div>
      ) : (
        <MasterKanban
          label="Chamados por etapa"
          columns={COLUMNS}
          items={grouped}
          getId={(t) => t.id}
          canDrop={(t, to) => {
            const v = canMove(t, digests.get(t.id) ?? null, to);
            return v.ok ? { ok: true } : v;
          }}
          onMove={doMove}
          onOpen={(t) => setOpenId(t.id)}
          columnLimit={{ concluido: 8, aguardando: 12 }}
          emptyLabel={(c) => (hasFilters ? "Nenhum com esses filtros." : c === "aberto" ? "Fila limpa." : "Nada aqui.")}
          renderCard={(t) => (
            <TicketCard
              ticket={t}
              digest={digests.get(t.id) ?? null}
              unread={unread[t.id] ?? 0}
              mine={!!masterUser && t.assigned_master_user_id === masterUser.id}
            />
          )}
        />
      )}

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpenId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-4xl" onOpenAutoFocus={(e) => e.preventDefault()}>
          {open && (
            <TicketDrawer
              ticket={open}
              digest={digests.get(open.id) ?? null}
              onMove={(to) => doMove(open, to)}
              moving={move.isPending}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function summarize(tickets: MasterSupportTicket[], digests: ReadonlyMap<string, TicketDiagnosisDigest>) {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);

  let semDiagnostico = 0;
  let parados = 0;
  let andamento = 0;
  let semDono = 0;
  let reabertos = 0;
  let custoReal = 0;
  let custoEstimado = 0;
  let executados = 0;

  for (const t of tickets) {
    const d = digests.get(t.id) ?? null;
    const col = columnOf(t, d);
    if (col === "aberto") {
      semDiagnostico++;
      if (t.impacto === "parado") parados++;
    }
    if (col === "andamento") andamento++;
    // Sem dono só conta na fila antes do trabalho: depois da resposta, dono não importa mais.
    if ((col === "aberto" || col === "diagnostico") && !t.assigned_master_user_id) semDono++;
    if (col !== "concluido" && isReopenAlert(t)) reabertos++;
    // OP-7: custo real só existe depois da execução — conta pela data dela.
    if (d?.executed_at && new Date(d.executed_at) >= inicioMes) {
      executados++;
      custoReal += Number(d.actual_cost_usd ?? 0);
      custoEstimado += Number(d.estimated_cost_usd ?? 0);
    }
  }
  return { semDiagnostico, parados, andamento, semDono, reabertos, custoReal, custoEstimado, executados };
}

function TicketCard({
  ticket,
  digest,
  unread,
  mine,
}: {
  ticket: MasterSupportTicket;
  digest: TicketDiagnosisDigest | null;
  unread: number;
  mine: boolean;
}) {
  const alerta = isReopenAlert(ticket);

  return (
    <article
      className={cn(
        "rounded-2xl border border-card-border bg-card p-3 shadow-relevo transition-[box-shadow,transform] duration-150 ease-standard hover:-translate-y-px hover:shadow-relevo-alto",
        alerta && "border-destructive/40",
      )}
    >
      <div className="flex items-start gap-2">
        <p className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold leading-snug" title={ticket.title}>
          {ticket.title}
        </p>
        {unread > 0 && (
          <span
            className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground"
            aria-label={`${unread} resposta${unread > 1 ? "s" : ""} não lida${unread > 1 ? "s" : ""} do cliente`}
          >
            {unread}
          </span>
        )}
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">{ticket.organization?.name ?? "—"}</p>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {ticket.severidade ? (
          <Badge variant="outline" className={cn("text-[10px]", SEVERIDADE_TONE[ticket.severidade])}>
            {SEVERIDADE_LABELS[ticket.severidade]}
          </Badge>
        ) : (
          <Badge variant="soft" className="text-[10px]">
            Não triado
          </Badge>
        )}
        {ticket.impacto === "parado" && (
          <Badge variant="destructive" className="bg-destructive/10 text-[10px] text-destructive">
            Cliente parado
          </Badge>
        )}
        {digest && (
          <Badge variant="soft" className="text-[10px]">
            {KIND_LABELS[digest.kind as DiagnosisKind]} · complexidade{" "}
            {COMPLEXITY_LABELS[digest.complexity as DiagnosisComplexity].toLowerCase()}
          </Badge>
        )}
        {ticket.status === "aguardando_cliente" && (
          <Badge variant="info" className="text-[10px]">
            Pediu informação
          </Badge>
        )}
        {alerta && (
          <Badge variant="destructive" className="gap-1 bg-destructive/10 text-[10px] text-destructive">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            Reaberto {ticket.reopen_count}×
          </Badge>
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
        <Hourglass className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">
          {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true, locale: ptBR })}
          <OverdueTag ticket={ticket} />
        </span>
        <span className="flex-1" />
        {digest?.estimated_cost_usd != null && (
          <span className="shrink-0 tabular-nums" title="Custo estimado · real">
            {usd(Number(digest.estimated_cost_usd))}
            {digest.actual_cost_usd != null && ` · ${usd(Number(digest.actual_cost_usd))}`}
          </span>
        )}
        {ticket.assigned_master_user_id && (
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-px font-semibold",
              mine ? "bg-primary-soft text-primary-soft-foreground" : "bg-muted text-foreground/70",
            )}
          >
            {mine ? "Você" : "Com alguém"}
          </span>
        )}
      </div>
    </article>
  );
}

function TicketDrawer({
  ticket,
  digest,
  onMove,
  moving,
}: {
  ticket: MasterSupportTicket;
  digest: TicketDiagnosisDigest | null;
  onMove: (to: OperacaoColumn) => void;
  moving: boolean;
}) {
  const { masterUser } = useMasterAuth();
  const claim = useClaimSupportTicket();
  const triage = useTriageSupportTicket();
  const col = columnOf(ticket, digest);
  const next = NEXT_COLUMN[col];
  const verdict = next ? canMove(ticket, digest, next) : null;
  const mine = ticket.assigned_master_user_id === masterUser?.id;

  return (
    <div className="flex min-h-full flex-col">
      <SheetHeader className="space-y-3 border-b border-border/60 px-6 pb-4 pt-6 text-left">
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <Badge variant="gold" className="text-[11px]">
            {OPERACAO_COLUMN_LABELS[col]}
          </Badge>
          {/* O status só aparece quando diz algo que a coluna não diz. */}
          {STATUS_LABELS_STAFF[ticket.status] !== OPERACAO_COLUMN_LABELS[col] && (
            <Badge variant="soft" className="text-[11px]">
              {STATUS_LABELS_STAFF[ticket.status]}
            </Badge>
          )}
          <Badge variant="soft" className="text-[11px]">
            {TIPO_LABELS[ticket.tipo]}
          </Badge>
          <span className="text-xs text-muted-foreground">{IMPACTO_LABELS[ticket.impacto]}</span>
        </div>
        <SheetTitle className="text-xl font-extrabold leading-tight tracking-tight">{ticket.title}</SheetTitle>
        <SheetDescription>{ticket.organization?.name ?? "Organização desconhecida"}</SheetDescription>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {next && verdict?.ok && (
            <Button size="sm" className="gap-1.5" disabled={moving} onClick={() => onMove(next)}>
              {verdict.move.kind === "enviar_resposta" ? (
                <MessageSquareReply className="h-4 w-4" aria-hidden />
              ) : (
                <ArrowRight className="h-4 w-4" aria-hidden />
              )}
              {MOVE_LABELS[verdict.move.kind]}
            </Button>
          )}
          {next && verdict && !verdict.ok && col !== "aguardando" && (
            <p className="text-xs text-muted-foreground">{verdict.reason}</p>
          )}
          <Select
            value={ticket.severidade ?? ALL}
            onValueChange={(v) =>
              triage.mutate(
                { ticketId: ticket.id, severidade: v as TicketSeveridade },
                { onError: (e: unknown) => notifyError(e, { fallback: "Não deu para definir a severidade." }) },
              )
            }
          >
            <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Severidade">
              <SelectValue placeholder="Severidade" />
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
          {col !== "concluido" &&
            (ticket.assigned_master_user_id ? (
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
                Assumir
              </Button>
            ))}
        </div>
      </SheetHeader>

      <TicketDetail ticket={ticket} />
    </div>
  );
}
