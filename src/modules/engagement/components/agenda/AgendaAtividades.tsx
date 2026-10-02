/**
 * A tela "Atividades" — Agenda interna unificada.
 *
 * Mostra eventos de 5 fontes internas (meetings, follow_ups,
 * scheduled_messages, pipe_confirmacao e meeting_events — o funil mergeado)
 * como dados primarios, com Google Calendar como overlay opcional.
 *
 * Vive em DOIS lugares e é o mesmo componente nos dois, de propósito:
 * - dentro do `AgendaPanel`, o painel sobreposto que o botão da lateral abre
 *   no desktop, deixando a página de baixo à mostra;
 * - na rota `/agenda`, que continua existindo para o celular (onde não há
 *   lateral e um painel de 65% não faz sentido), para o link do menu inferior,
 *   para a paleta de comandos e para link direto.
 *
 * Duplicar a tela para atender os dois seria a estrutura paralela que o pedido
 * proíbe — daí a extração.
 */

import { useState, useMemo, useCallback } from "react";
import {
  format,
  startOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  addMonths,
  isSameDay,
  isSameMonth,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Check,
  Clock,
  Hourglass,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { KpiRow, KpiTile } from "@/components/ui/bento";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useViewport } from "@/shared/hooks/use-viewport";
import { AgendaProximo } from "./AgendaProximo";
import { cn } from "@/lib/utils";
import { useAuth, useCanDo, useIdentity, useTeamMembers } from "@/modules/identity";
import { useAgendaEvents } from "@/modules/engagement/hooks/useAgendaEvents";
import { useMyAgendaOwnership } from "@/modules/engagement/hooks/useMyAgendaOwnership";
import {
  useDeleteMeeting,
  useUpdateMeeting,
  type MeetingStatus,
} from "@/modules/engagement/hooks/useMeetings";
import {
  useCalendarEvents,
  useGoogleCalendarStatus,
} from "@/modules/integrations/hooks/useGoogleCalendar";
import { useCalendarSharing } from "@/modules/integrations/hooks/useGoogleCalendarSharing";

import type {
  AgendaStatusFilter,
  AttendanceOutcome,
  EventTypeKey,
  UnifiedEvent,
  ViewType,
} from "./agenda-helpers";
import {
  EVENT_TYPE_KEYS,
  EVENT_TYPE_LABELS,
  getWeekDays,
  normalizeAgendaEvents,
  normalizeGoogleEvents,
  normalizeEventType,
  buildOwnerIdentity,
  isOwnedBy,
  matchesStatusFilter,
  rawEventId,
  resumirComparecimento,
  statusDoResultado,
  STATUS_SEM_RESULTADO,
} from "./agenda-helpers";
import {
  AgendaFilterBar,
  ALL_OPTION,
  type AgendaOwnerOption,
} from "./AgendaFilterBar";
import { TimeGrid } from "./TimeGrid";
import { MonthView } from "./MonthView";
import { DayAgendaView } from "./DayAgendaView";
import {
  EventDetailPopover,
  type PopoverState,
} from "./EventDetailPopover";
import { CreateMeetingDialog } from "./CreateMeetingDialog";
import { EditMeetingDialog } from "./EditMeetingDialog";
// Cross-module pela API pública: `engagement` já consome `ScheduleMessageModal`
// de `communication` (ver CLAUDE.md do módulo), e o barrel é o caminho que a
// regra de boundaries permite.
import { ScheduleMessageModal } from "@/modules/communication";
import { IconChip } from "@/components/ui/bento";

// ─── Google Calendar user colors (for shared calendars overlay) ───────────────

const USER_COLORS = [
  "#4285F4",   // Google blue -- own
  "#10B981",   // emerald
  "#3B82F6",   // blue
  "#8B5CF6",   // violet
  "#EC4899",   // pink
  "#F97316",   // orange
  "#06B6D4",   // cyan
];

// ─── Main component ──────────────────────────────────────────────────────────

interface AgendaAtividadesProps {
  /**
   * Quando presente, o cabeçalho ganha o botão de fechar — quem fornece é o
   * `AgendaPanel`. Na rota `/agenda` não existe o que fechar, então a rota não
   * passa nada e o botão simplesmente não é desenhado.
   */
  onClose?: () => void;
}

export function AgendaAtividades({ onClose }: AgendaAtividadesProps) {
  const { session } = useAuth();
  const { userId, teamMemberId, isAdmin, isReady: identityReady } = useIdentity();
  const { data: teamMembers = [] } = useTeamMembers();

  // V5 (CTO, 02/10): a SEMANA é a visão principal no computador — ela existia
  // no código e estava inalcançável. No celular abre no Dia (a grade do mês e a
  // da semana não cabem a 390 px). O Dia continua sendo LISTA cronológica, a
  // decisão de 24/08.
  const { isMobile } = useViewport();
  const [view, setView] = useState<ViewType>(() => (isMobile ? "day" : "week"));
  const [date, setDate] = useState(new Date());
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialStart, setCreateInitialStart] = useState<Date | undefined>();
  /** Id CRU da reunião em edição (sem o prefixo de fonte). `null` = fechado. */
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
  /** Mensagem agendada em edição — o evento inteiro. `null` = fechado. */
  const [editingScheduled, setEditingScheduled] = useState<UnifiedEvent | null>(null);

  // ── Filtros da tela ─────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<AgendaStatusFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>(ALL_OPTION);

  // Multi-seleção, como sempre foi nesta tela: dá para ver reunião + ligação
  // sem tarefa. Um Select de valor único derrubaria isso.
  const [activeTypes, setActiveTypes] = useState<Set<EventTypeKey>>(
    () => new Set<EventTypeKey>(EVENT_TYPE_KEYS),
  );

  const toggleType = useCallback((type: EventTypeKey) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // ── Escopo de visibilidade ──────────────────────────────────────────────────
  // A agenda é da OPERAÇÃO por padrão: todo mundo vê os compromissos de todo
  // mundo. O recorte "só os meus" existe, mas agora é POLÍTICA — a permissão
  // `agenda.view_all`, que nasce ligada e um admin desliga por membro (ou por
  // org). Antes o recorte era o CARGO: `seesEveryone = isAdmin`, e nenhum admin
  // tinha escolhido isso.
  //
  // `useCanDo` já devolve `true` para master e para admin da org, então o
  // `isAdmin` daqui é redundância deliberada: `useCanDo` depende do mapa da
  // edge function `get-member-permissions`, e essa edge function ainda NÃO lê
  // `organization_feature_defaults` (lê só o override do membro e o default
  // global). O admin não pode perder a operação por causa desse buraco.
  //
  // ⚠️ Isto NÃO é a fronteira. Quem decide é `get_agenda_events_scoped`, no
  // banco. Aqui o filtro é o que rotula a tela, cobre o evento do Google (que
  // não passa pela RPC) e sustenta o caminho degradado enquanto a migration não
  // estiver aplicada.
  const { allowed: podeVerTodos, isLoading: permissaoCarregando } =
    useCanDo("agenda.view_all");

  // Falhar fechado enquanto carrega: a lista abre recortada e completa em
  // seguida. O inverso — nascer completa e encolher — mostraria compromisso
  // alheio a quem não podia, mesmo que por meio segundo.
  const seesEveryone =
    identityReady && !permissaoCarregando && (isAdmin || podeVerTodos);

  const ownIdentity = useMemo(
    () => buildOwnerIdentity(userId, teamMemberId),
    [userId, teamMemberId],
  );

  const ownerOptions: AgendaOwnerOption[] = useMemo(() => {
    if (!seesEveryone) return [];
    return teamMembers
      .filter((m) => m.is_active !== false && !!m.name)
      .map((m) => ({ value: m.id, label: m.name as string }));
  }, [seesEveryone, teamMembers]);

  // O filtro de atendente escolhe um `team_members.id`, mas `created_by` chega
  // ora como id de membro ora como id de usuário — casar contra as duas chaves.
  // Sem o seletor na tela o filtro não pode valer: senão um valor escolhido
  // antes ficaria preso, recortando a agenda sem controle visível para desfazer.
  // Também não pode valer um atendente que saiu da lista (desativado, ou troca
  // de org): o `SelectItem` some, o gatilho fica sem rótulo e a grade esvazia
  // sem causa visível. O recorte nasce das opções REALMENTE oferecidas.
  const ownerFilterIdentity = useMemo(() => {
    if (!seesEveryone || ownerFilter === ALL_OPTION) return null;
    if (!ownerOptions.some((o) => o.value === ownerFilter)) return null;
    const member = teamMembers.find((m) => m.id === ownerFilter);
    return buildOwnerIdentity(member?.user_id ?? null, member?.id ?? ownerFilter);
  }, [seesEveryone, ownerFilter, ownerOptions, teamMembers]);

  // O que é meu e não cabe em `created_by` — convites e confirmação como SDR.
  const { data: meusPorFora } = useMyAgendaOwnership(teamMemberId);

  // ── Google Calendar overlay data ────────────────────────────────────────────
  const { data: gcalStatus } = useGoogleCalendarStatus();
  const { data: sharingData } = useCalendarSharing();
  const ownUserId = session?.user?.id ?? "";
  const googleConnected = !!gcalStatus?.connected;

  // Build owner calendars list for normalizing Google events
  const googleOwnerCalendars = useMemo(() => {
    const list: Array<{ id: string; name: string; color: string }> = [];
    if (gcalStatus?.connected) {
      list.push({ id: ownUserId, name: "Meu Calendário", color: USER_COLORS[0] });
    }
    sharingData?.incoming?.forEach((share, idx) => {
      list.push({
        id: share.owner_id,
        name: share.owner?.name ?? "Colega",
        color: USER_COLORS[(idx + 1) % USER_COLORS.length],
      });
    });
    return list;
  }, [gcalStatus, sharingData, ownUserId]);

  // ── Date range for queries ──────────────────────────────────────────────────
  const { startDate, endDate } = useMemo(() => {
    if (view === "week") {
      const s = startOfWeek(date, { locale: ptBR });
      return { startDate: s, endDate: addDays(s, 7) };
    }
    // dia e mês -- um mês de folga de cada lado cobre o transbordo da grade e
    // os pontinhos do mini-calendário.
    return {
      startDate: new Date(date.getFullYear(), date.getMonth() - 1, 1),
      endDate: new Date(date.getFullYear(), date.getMonth() + 2, 0),
    };
  }, [date, view]);

  // ── Data: internal events (primary) ─────────────────────────────────────────
  const {
    data: agendaRawEvents = [],
    isLoading: agendaLoading,
    isError: agendaFalhou,
    refetch: refetchAgenda,
  } = useAgendaEvents(startDate, endDate);

  // ── Data: Google Calendar events (optional overlay) ─────────────────────────
  const {
    data: googleRawEvents,
    isLoading: googleLoading,
    refetch: refetchGoogle,
  } = useCalendarEvents(startDate, endDate);

  const isLoading = agendaLoading || googleLoading;

  // ── Merge + filter events ───────────────────────────────────────────────────
  const allEvents: UnifiedEvent[] = useMemo(() => {
    const internal = normalizeAgendaEvents(agendaRawEvents);
    const google = googleRawEvents
      ? normalizeGoogleEvents(
          googleRawEvents as unknown[],
          googleOwnerCalendars,
          ownUserId,
        )
      : [];

    // Deduplicate: if an internal meeting has a google_event_id, hide the
    // Google overlay duplicate to avoid showing the same event twice.
    const googleEventIds = new Set(
      internal
        .filter((e) => e.googleEventId)
        .map((e) => `google-${e.googleEventId}`),
    );

    const deduped = google.filter((g) => !googleEventIds.has(g.id));

    return [...internal, ...deduped].filter((e) => {
      // 1. Escopo: usuário comum vê só os próprios compromissos.
      if (!seesEveryone && !isOwnedBy(e, ownIdentity, meusPorFora)) return false;
      // 2. Atendente escolhido (só existe para quem vê todos).
      if (ownerFilterIdentity) {
        if (!e.createdBy || !ownerFilterIdentity.has(e.createdBy)) return false;
      }
      // 3. Tipo.
      if (!activeTypes.has(normalizeEventType(e.eventType))) return false;
      // 4. Estado (pendente / finalizado).
      return matchesStatusFilter(e, statusFilter);
    });
  }, [
    agendaRawEvents,
    googleRawEvents,
    googleOwnerCalendars,
    ownUserId,
    seesEveryone,
    ownIdentity,
    meusPorFora,
    ownerFilterIdentity,
    activeTypes,
    statusFilter,
  ]);

  /**
   * O que está de fato à vista. A consulta busca três meses (o mês exibido mais
   * um de folga de cada lado, para a grade transbordar e o mini-calendário
   * marcar os pontos), então contar `allEvents` anunciaria o triplo.
   */
  const eventosNoPeriodo = useMemo(() => {
    if (view === "day") {
      return allEvents.filter((e) => isSameDay(e.start, date));
    }
    if (view === "week") {
      const dias = getWeekDays(date);
      return allEvents.filter((e) =>
        dias.some((d) => isSameDay(e.start, d)),
      );
    }
    return allEvents.filter((e) => isSameMonth(e.start, date));
  }, [allEvents, date, view]);

  /**
   * Comparecimento do período. `total` é quantos PODEM ter resultado — só
   * `meetings`; incluir follow-up e confirmação encheria "sem registro" de item
   * que nunca vai poder ser registrado aqui.
   */
  const resumo = useMemo(() => {
    const r = resumirComparecimento(eventosNoPeriodo);
    return { ...r, total: r.compareceu + r.naoCompareceu + r.semRegistro };
  }, [eventosNoPeriodo]);

  /** "4 reuniões · 2 ligações" — a nota do KPI de compromissos. */
  const contagemPorTipo = useMemo(() => {
    const PLURAL: Record<EventTypeKey, string> = {
      meeting: "reuniões",
      call: "ligações",
      follow_up: "follow-ups",
      task: "tarefas",
      other: "outros",
    };
    const conta = new Map<EventTypeKey, number>();
    for (const e of eventosNoPeriodo) {
      const tipo = normalizeEventType(e.eventType);
      conta.set(tipo, (conta.get(tipo) ?? 0) + 1);
    }
    return [...conta.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tipo, n]) => `${n} ${n === 1 ? EVENT_TYPE_LABELS[tipo].toLowerCase() : PLURAL[tipo]}`)
      .join(" · ");
  }, [eventosNoPeriodo]);

  /** Hoje, independentemente da visão: quantos e qual é o próximo. */
  const hoje = useMemo(() => {
    const agora = Date.now();
    const doDia = allEvents.filter((e) => isSameDay(e.start, new Date()));
    const proximo = doDia
      .filter((e) => e.start.getTime() >= agora)
      .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
    return { total: doDia.length, proximo };
  }, [allEvents]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const deleteMeeting = useDeleteMeeting();
  const updateMeeting = useUpdateMeeting();

  /**
   * Grava o resultado do compromisso.
   *
   * Nenhuma coluna nova: `meetings.status` já tinha `completed` e `no_show` no
   * CHECK desde o baseline, e `useUpdateMeeting` já filtra por
   * `organization_id` e invalida `agenda-events` — a contagem no cabeçalho se
   * atualiza sozinha, sem somar nada à mão. Como ela é DERIVADA do estado
   * atual e não acumulada, trocar o resultado só move o evento de balde: não
   * existe caminho para contar duas vezes.
   */
  const handleSetOutcome = useCallback(
    async (event: UnifiedEvent, resultado: AttendanceOutcome | null) => {
      await updateMeeting.mutateAsync({
        id: rawEventId(event),
        status: (resultado
          ? statusDoResultado(resultado)
          : STATUS_SEM_RESULTADO) as MeetingStatus,
      });
    },
    [updateMeeting],
  );

  const handleDeleteMeeting = useCallback(
    async (meetingId: string) => {
      await deleteMeeting.mutateAsync(meetingId);
    },
    [deleteMeeting],
  );

  const handleDeleteGoogleEvent = useCallback(
    async (event: UnifiedEvent) => {
      if (!session?.access_token) throw new Error("Não autenticado");

      const base = (
        (import.meta.env.VITE_SUPABASE_URL as string) ?? ""
      ).replace(/\/$/, "");
      const rawId = event.id.replace(/^google-/, "");
      const params = new URLSearchParams({ event_id: rawId });
      if (event.googleCalendarOwnerId) {
        params.set("calendar_owner_id", event.googleCalendarOwnerId);
      }

      const res = await fetch(
        `${base}/functions/v1/google-calendar-events?${params}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error("Erro ao excluir evento", {
          description:
            (err as { message?: string }).message ?? "Tente novamente",
        });
        throw new Error("delete failed");
      }

      toast.success("Evento excluído");
      refetchGoogle();
    },
    [session, refetchGoogle],
  );

  // ── Navigation ──────────────────────────────────────────────────────────────
  const navigate = useCallback(
    (dir: "prev" | "next" | "today") => {
      if (dir === "today") {
        setDate(new Date());
        return;
      }
      const d = dir === "next" ? 1 : -1;
      if (view === "day") setDate((v) => addDays(v, d));
      else if (view === "week")
        setDate((v) => (d === 1 ? addWeeks(v, 1) : subWeeks(v, 1)));
      else setDate((v) => (d === 1 ? addMonths(v, 1) : addMonths(v, -1)));
    },
    [view],
  );

  // ── Date label ──────────────────────────────────────────────────────────────
  const dateLabel = useMemo(() => {
    if (view === "day")
      return format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
    if (view === "week") {
      const days = getWeekDays(date);
      const [first, last] = [days[0], days[6]];
      if (first.getMonth() === last.getMonth())
        return `${format(first, "d")} - ${format(last, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}`;
      return `${format(first, "d MMM", { locale: ptBR })} - ${format(last, "d MMM yyyy", { locale: ptBR })}`;
    }
    return format(date, "MMMM 'de' yyyy", { locale: ptBR });
  }, [date, view]);

  // ── Event handlers ──────────────────────────────────────────────────────────
  const handleEventClick = useCallback(
    (e: React.MouseEvent, event: UnifiedEvent) => {
      e.stopPropagation();
      setPopover({ event, x: e.clientX, y: e.clientY });
    },
    [],
  );

  const handleSlotClick = useCallback(
    (day: Date, hour = 9) => {
      const slotStart = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        hour,
      );
      setCreateInitialStart(slotStart);
      setCreateOpen(true);
    },
    [],
  );

  const handleRefresh = useCallback(() => {
    refetchAgenda();
    if (googleConnected) refetchGoogle();
  }, [refetchAgenda, refetchGoogle, googleConnected]);

  const handleNewEvent = useCallback(() => {
    setCreateInitialStart(undefined);
    setCreateOpen(true);
  }, []);

  /**
   * Abre a edição. Fecha o popover junto — deixar os dois abertos empilharia
   * um card flutuante posicionado por coordenada de clique atrás de um modal,
   * e o card não reposiciona quando o modal trava a rolagem do corpo.
   *
   * `rawEventId` porque a Agenda prefixa o id com a fonte (`meeting-<uuid>`)
   * para as cinco tabelas não colidirem — é o mesmo corte que o registro de
   * comparecimento já faz antes de chamar `useUpdateMeeting`.
   */
  const handleEditMeeting = useCallback((event: UnifiedEvent) => {
    setEditingMeetingId(rawEventId(event));
    setPopover(null);
  }, []);

  /**
   * Edição de mensagem agendada. Guarda o EVENTO inteiro, não só o id, porque o
   * formulário precisa do texto e da hora atuais — e a RPC da Agenda já traz os
   * dois (`description` é o `message_content` cru; `start` é o `scheduled_at`).
   * Buscar a linha de novo só para reler o que já está em mãos seria um
   * round-trip a mais para abrir um modal.
   *
   * O que a RPC NÃO traz — telefone e chip — o formulário não usa em modo
   * edição: `phoneNumber`/`instanceId` só alimentam o INSERT.
   */
  const handleEditScheduledMessage = useCallback((event: UnifiedEvent) => {
    setEditingScheduled(event);
    setPopover(null);
  }, []);

  /** "+N mais" abre o dia inteiro — a lista cronológica que já existe. */
  const handleShowMore = useCallback((day: Date) => {
    setDate(day);
    setView("day");
  }, []);

  const weekDays = view === "week" ? getWeekDays(date) : [date];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      {/* Cabeçalho — o `PageHeader` do V5 nos DOIS lugares onde a tela vive.
          No painel sobreposto (`onClose` presente) o título desce para o
          tamanho que o próprio `PageHeader` já usa no celular: o painel é uma
          camada sobre outra página, e um título de página cheio ali competiria
          com o título da página de baixo, que continua à mostra. O h1 e o nome
          acessível são os mesmos nos dois contextos — só o corpo muda. */}
      <PageHeader
        title="Atividades"
        subtitle={
          seesEveryone
            ? "Crie, edite e gerencie as atividades da equipe."
            : "Crie, edite e gerencie suas atividades."
        }
        className={cn(onClose && "[&_h1]:text-[1.375rem]")}
        tabs={
          <Tabs value={view} onValueChange={(v) => setView(v as ViewType)}>
            <TabsList variant="pill" aria-label="Visão da agenda">
              <TabsTrigger value="week">Semana</TabsTrigger>
              <TabsTrigger value="month">Mês</TabsTrigger>
              <TabsTrigger value="day">Dia</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              onClick={handleRefresh}
              disabled={isLoading}
              title="Atualizar"
              aria-label="Atualizar agenda"
            >
              <RefreshCw className={cn(isLoading && "animate-spin")} />
            </Button>
            <Button onClick={handleNewEvent}>
              <Plus />
              Nova atividade
            </Button>
            {onClose && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                title="Fechar"
                aria-label="Fechar Atividades"
              >
                <X />
              </Button>
            )}
          </>
        }
      />

      {/* KPIs do período à vista. Todos DERIVADOS da lista já em tela — acompanham
          filtros e escopo, e não podem divergir do que a grade mostra. */}
      <KpiRow cols={4}>
        <KpiTile
          label={view === "week" ? "Compromissos na semana" : view === "month" ? "Compromissos no mês" : "Compromissos no dia"}
          value={isLoading ? "·" : eventosNoPeriodo.length.toLocaleString("pt-BR")}
          icon={CalendarDays}
          tone="gold"
          loading={isLoading}
          note={contagemPorTipo || "Nada marcado no período"}
        />
        <KpiTile
          label="Reuniões realizadas"
          value={isLoading ? "·" : `${resumo.compareceu}`}
          icon={Check}
          tone="good"
          loading={isLoading}
          note={
            resumo.compareceu + resumo.naoCompareceu > 0
              ? `de ${resumo.compareceu + resumo.naoCompareceu} com desfecho · ${resumo.naoCompareceu} não compareceram`
              : "Nenhum desfecho registrado"
          }
        />
        <KpiTile
          label={`Hoje · ${format(new Date(), "EEEE", { locale: ptBR })}`}
          value={isLoading ? "·" : hoje.total.toLocaleString("pt-BR")}
          icon={Clock}
          tone="info"
          loading={isLoading}
          note={hoje.proximo ? `próximo: ${format(hoje.proximo.start, "HH:mm")} · ${hoje.proximo.leadName ?? hoje.proximo.title}` : "Nada mais hoje"}
        />
        <KpiTile
          label="Aguardando desfecho"
          value={isLoading ? "·" : resumo.semRegistro.toLocaleString("pt-BR")}
          icon={Hourglass}
          tone={resumo.semRegistro > 0 ? "bad" : "neutral"}
          loading={isLoading}
          note={resumo.semRegistro > 0 ? "Reuniões passadas sem compareceu/faltou" : "Tudo registrado"}
        />
      </KpiRow>

      {/* Abas de estado + filtros */}
      <AgendaFilterBar
        status={statusFilter}
        onStatusChange={setStatusFilter}
        owner={ownerFilter}
        onOwnerChange={setOwnerFilter}
        ownerOptions={ownerOptions}
        activeTypes={activeTypes}
        onToggleType={toggleType}
      />

      {/* Navegação de período + alternância de visão */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {/* `first-letter:uppercase`, e não `capitalize`: o rótulo vem do
              date-fns em minúsculas ("agosto de 2026") e `capitalize` subiria
              também o "De". */}
          <h2 className="truncate text-[15px] font-bold tracking-[-0.02em] text-foreground first-letter:uppercase">
            {dateLabel}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => navigate("prev")}
              aria-label="Período anterior"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => navigate("next")}
              aria-label="Próximo período"
            >
              <ChevronRight />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3"
              onClick={() => navigate("today")}
            >
              Hoje
            </Button>
          </div>
        </div>

      </div>

      {/* Estado de ERRO — sem isto, RPC quebrada renderiza um calendário vazio
          indistinguível de "não há nada marcado". */}
      {agendaFalhou && (
        <div
          role="alert"
          aria-live="polite"
          // Só token: a cor de estado mora na borda, no banho e no ícone; o
          // TEXTO fica em `foreground`/`muted-foreground`. Vermelho como texto
          // é o que obrigava o par de escala `x dark:y` aqui antes — com o
          // texto neutro o contraste vale nos dois temas sem par nenhum.
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3"
        >
          <div className="flex min-w-0 items-center gap-3">
            <IconChip icon={AlertTriangle} tone="bad" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                Não foi possível carregar a agenda.
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                O calendário abaixo pode estar incompleto.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            className="shrink-0"
          >
            <RefreshCw />
            Tentar de novo
          </Button>
        </div>
      )}

      {/* Calendário + coluna do próximo compromisso (fora do painel sobreposto,
          que é estreito demais para duas colunas). */}
      <div className={cn("grid min-h-0 flex-1 items-start gap-4", !onClose && "xl:grid-cols-[minmax(0,1fr)_340px]")}>
      <div className="flex min-h-0 min-w-0 flex-col">
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {view === "month" ? (
            <MonthView
              date={date}
              events={allEvents}
              onEventClick={handleEventClick}
              onSlotClick={(day) => handleSlotClick(day)}
              onShowMore={handleShowMore}
              showOwner={seesEveryone}
            />
          ) : view === "day" ? (
            <DayAgendaView
              date={date}
              events={allEvents}
              onSelectDate={setDate}
              onEventClick={handleEventClick}
              showOwner={seesEveryone}
            />
          ) : (
            <TimeGrid
              days={weekDays}
              events={allEvents}
              onEventClick={handleEventClick}
              onSlotClick={handleSlotClick}
            />
          )}
        </motion.div>
      </AnimatePresence>
      </div>
      {!onClose && (
        <AgendaProximo
          events={allEvents}
          onEventClick={handleEventClick}
          googleConnected={googleConnected}
          googleEmail={gcalStatus?.google_email ?? null}
          className="max-xl:hidden"
        />
      )}
      </div>

      {/* Event popover */}
      <AnimatePresence>
        {popover && (
          <EventDetailPopover
            state={popover}
            onClose={() => setPopover(null)}
            onDeleteMeeting={handleDeleteMeeting}
            onSetOutcome={handleSetOutcome}
            onDeleteGoogleEvent={handleDeleteGoogleEvent}
            onEditMeeting={handleEditMeeting}
            onEditScheduledMessage={handleEditScheduledMessage}
          />
        )}
      </AnimatePresence>

      {/* Create meeting dialog */}
      <CreateMeetingDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialStart={createInitialStart}
      />

      {/* Edit meeting dialog */}
      <EditMeetingDialog
        meetingId={editingMeetingId}
        open={!!editingMeetingId}
        onOpenChange={(aberto) => {
          if (!aberto) setEditingMeetingId(null);
        }}
      />

      {/* Editar mensagem agendada — mesmo formulário do chat, em modo edição.
          Montado por CHAVE (`key`) porque o formulário guarda texto e data em
          `useState` inicializado pelas props: sem a chave, abrir um segundo
          agendamento reusaria a instância e mostraria o conteúdo do primeiro. */}
      {editingScheduled && (
        <ScheduleMessageModal
          key={editingScheduled.id}
          open
          onOpenChange={(aberto) => {
            if (!aberto) setEditingScheduled(null);
          }}
          leadId={editingScheduled.leadId ?? ""}
          leadName={editingScheduled.leadName ?? "este contato"}
          phoneNumber=""
          editingId={rawEventId(editingScheduled)}
          editingContent={editingScheduled.description ?? ""}
          editingScheduledAt={editingScheduled.start}
        />
      )}
    </div>
  );
}
