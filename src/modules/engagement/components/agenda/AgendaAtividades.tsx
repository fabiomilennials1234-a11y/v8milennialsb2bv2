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
  ChevronLeft,
  ChevronRight,
  Check,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

  // A grade do mês é a visão principal. O dia continua acessível: era a visão
  // de produção antes desta tela e a lista cronológica é o que a operação usa
  // para tocar o dia. A semana segue inerte (reversível), como já estava.
  const [view, setView] = useState<ViewType>("month");
  const [date, setDate] = useState(new Date());
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialStart, setCreateInitialStart] = useState<Date | undefined>();
  /** Id CRU da reunião em edição (sem o prefixo de fonte). `null` = fechado. */
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);

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
      list.push({ id: ownUserId, name: "Meu Calendario", color: USER_COLORS[0] });
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
      if (!session?.access_token) throw new Error("Nao autenticado");

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

      toast.success("Evento excluido");
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

  /** "+N mais" abre o dia inteiro — a lista cronológica que já existe. */
  const handleShowMore = useCallback((day: Date) => {
    setDate(day);
    setView("day");
  }, []);

  const weekDays = view === "week" ? getWeekDays(date) : [date];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      {/* Cabeçalho da página — mesmo molde de Leads/Copilot */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <motion.h1
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-2xl font-bold"
          >
            Atividades
          </motion.h1>
          <p className="mt-1 text-muted-foreground">
            {seesEveryone
              ? "Crie, edite e gerencie as atividades da equipe."
              : "Crie, edite e gerencie suas atividades."}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isLoading}
            title="Atualizar"
            aria-label="Atualizar agenda"
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
          <Button onClick={handleNewEvent} className="gap-2">
            <Plus className="h-4 w-4" />
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
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

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
        <div className="flex min-w-0 items-center gap-1">
          <h2 className="truncate text-sm font-semibold uppercase tracking-wide text-foreground">
            {dateLabel}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => navigate("prev")}
            aria-label="Período anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => navigate("next")}
            aria-label="Próximo período"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => navigate("today")}
          >
            Hoje
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {isLoading
              ? "Carregando…"
              : eventosNoPeriodo.length === 0
                ? "Nenhuma atividade"
                : `${eventosNoPeriodo.length} ${eventosNoPeriodo.length === 1 ? "atividade" : "atividades"}`}
          </span>

          {/* Comparecimento do período. Some quando não há nada registrável —
              zero sem contexto é ruído, não informação.
              O número é DERIVADO da lista já em tela: acompanha os filtros,
              acompanha o escopo de quem está vendo, e não pode divergir do que
              a grade mostra. Trocar um resultado move de balde; não soma. */}
          {!isLoading && resumo.total > 0 && (
            <div
              className="flex items-center gap-2.5 text-xs tabular-nums"
              aria-label="Comparecimento no período"
            >
              <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                <Check className="h-3 w-3 shrink-0" strokeWidth={3} aria-hidden="true" />
                {resumo.compareceu}
                <span className="sr-only">compareceram</span>
              </span>
              <span className="flex items-center gap-1 text-red-700 dark:text-red-300">
                <X className="h-3 w-3 shrink-0" strokeWidth={3} aria-hidden="true" />
                {resumo.naoCompareceu}
                <span className="sr-only">não compareceram</span>
              </span>
              {resumo.semRegistro > 0 && (
                <span className="text-muted-foreground">
                  {resumo.semRegistro} sem registro
                </span>
              )}
            </div>
          )}
          {/* Mesma linguagem do segmentado de estado: pílula sobre superfície
              afundada. Dois segmentados com formas diferentes lado a lado leem
              como dois sistemas. */}
          <div className="flex gap-1 rounded-full border border-border bg-sunken p-1">
            {(["month", "day"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={cn(
                  "rounded-full px-3 py-1 text-[12px] transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  view === v
                    ? "border border-border bg-card font-semibold text-foreground shadow-sm"
                    : "font-medium text-foreground/80 hover:text-foreground",
                )}
              >
                {v === "month" ? "Mês" : "Dia"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Estado de ERRO — sem isto, RPC quebrada renderiza um calendário vazio
          indistinguível de "não há nada marcado". */}
      {agendaFalhou && (
        <div
          role="alert"
          aria-live="polite"
          // Cor crua sempre em par `x dark:y` — o idioma que a #1792 fixou em
          // `SessionDeadBanner`. Só o tom escuro deixaria o texto a 1,1:1 no
          // tema claro.
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-800 dark:text-red-100"
        >
          <div className="flex min-w-0 items-center gap-3">
            <AlertTriangle
              className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-800 dark:text-red-50">
                Não foi possível carregar a agenda.
              </p>
              <p className="mt-0.5 text-xs text-red-700/90 dark:text-red-200/80">
                O calendário abaixo pode estar incompleto.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            className="shrink-0 gap-2 border-red-500/40 bg-red-500/10 text-red-800 hover:bg-red-500/20 hover:text-red-900 dark:border-red-400/40 dark:text-red-50 dark:hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Tentar de novo
          </Button>
        </div>
      )}

      {/* Calendário */}
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
    </div>
  );
}
