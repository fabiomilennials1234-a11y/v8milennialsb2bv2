/**
 * Pagina /agenda -- Agenda interna unificada
 *
 * Mostra eventos de 4 fontes internas (meetings, follow_ups,
 * scheduled_messages, pipe_confirmacao) como dados primarios,
 * com Google Calendar como overlay opcional.
 *
 * Componentes extraidos em src/components/agenda/ para
 * manutenibilidade.
 */

import { useState, useMemo, useCallback } from "react";
import {
  format,
  startOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  addMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useAgendaEvents } from "@/hooks/useAgendaEvents";
import { useDeleteMeeting } from "@/hooks/useMeetings";
import {
  useCalendarEvents,
  useGoogleCalendarStatus,
} from "@/hooks/useGoogleCalendar";
import { useCalendarSharing } from "@/hooks/useGoogleCalendarSharing";

import type { EventTypeKey, UnifiedEvent } from "@/components/agenda/agenda-helpers";
import {
  getWeekDays,
  normalizeAgendaEvents,
  normalizeGoogleEvents,
  EVENT_TYPE_KEYS,
  normalizeEventType,
} from "@/components/agenda/agenda-helpers";
import { AgendaTopBar, type ViewType } from "@/components/agenda/AgendaTopBar";
import { TimeGrid } from "@/components/agenda/TimeGrid";
import { MonthView } from "@/components/agenda/MonthView";
import { DayAgendaView } from "@/components/agenda/DayAgendaView";
import {
  EventDetailPopover,
  type PopoverState,
} from "@/components/agenda/EventDetailPopover";
import { CreateMeetingDialog } from "@/components/agenda/CreateMeetingDialog";

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

export default function Agenda() {
  const { session } = useAuth();

  // View switcher removed — Agenda is day-only. Week/Month code paths remain
  // inert (reversible) should we reintroduce the switcher later.
  const [view] = useState<ViewType>("day");
  const [date, setDate] = useState(new Date());
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialStart, setCreateInitialStart] = useState<Date | undefined>();

  // ── Event-type visibility toggles ───────────────────────────────────────────
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
    if (view === "day") {
      // Fetch the whole month so the mini-calendar can mark days with events;
      // the day list itself filters down to the selected date.
      return {
        startDate: new Date(date.getFullYear(), date.getMonth() - 1, 1),
        endDate: new Date(date.getFullYear(), date.getMonth() + 2, 0),
      };
    }
    if (view === "week") {
      const s = startOfWeek(date, { locale: ptBR });
      return { startDate: s, endDate: addDays(s, 7) };
    }
    // month -- pad one month each side for grid overflow
    return {
      startDate: new Date(date.getFullYear(), date.getMonth() - 1, 1),
      endDate: new Date(date.getFullYear(), date.getMonth() + 2, 0),
    };
  }, [date, view]);

  // ── Data: internal events (primary) ─────────────────────────────────────────
  const {
    data: agendaRawEvents = [],
    isLoading: agendaLoading,
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

    return [...internal, ...deduped].filter((e) =>
      activeTypes.has(normalizeEventType(e.eventType)),
    );
  }, [agendaRawEvents, googleRawEvents, activeTypes, googleOwnerCalendars, ownUserId]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const deleteMeeting = useDeleteMeeting();

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

  // ── Event-type toggles for the topbar ───────────────────────────────────────
  const typeToggles = useMemo(
    () => EVENT_TYPE_KEYS.map((key) => ({ key, active: activeTypes.has(key) })),
    [activeTypes],
  );

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

  const weekDays = view === "week" ? getWeekDays(date) : [date];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Top Bar */}
      <AgendaTopBar
        dateLabel={dateLabel}
        onNavigate={navigate}
        typeToggles={typeToggles}
        onToggleType={toggleType}
        isLoading={isLoading}
        onRefresh={handleRefresh}
        onNewEvent={handleNewEvent}
        googleConnected={googleConnected}
      />

      {/* Calendar body */}
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="flex-1 overflow-hidden flex flex-col"
        >
          {view === "month" ? (
            <MonthView
              date={date}
              events={allEvents}
              onEventClick={handleEventClick}
              onSlotClick={(day) => handleSlotClick(day)}
            />
          ) : view === "day" ? (
            <DayAgendaView
              date={date}
              events={allEvents}
              onSelectDate={setDate}
              onEventClick={handleEventClick}
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
            onDeleteGoogleEvent={handleDeleteGoogleEvent}
          />
        )}
      </AnimatePresence>

      {/* Create meeting dialog */}
      <CreateMeetingDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialStart={createInitialStart}
      />
    </div>
  );
}
