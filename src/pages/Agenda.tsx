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
  startOfDay,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/modules/identity";
import { useAgendaEvents } from "@/hooks/useAgendaEvents";
import { useDeleteMeeting } from "@/hooks/useMeetings";
import {
  useCalendarEvents,
  useGoogleCalendarStatus,
} from "@/hooks/useGoogleCalendar";
import { useCalendarSharing } from "@/hooks/useGoogleCalendarSharing";

import type { EventSource, UnifiedEvent } from "@/components/agenda/agenda-helpers";
import {
  getWeekDays,
  normalizeAgendaEvents,
  normalizeGoogleEvents,
} from "@/components/agenda/agenda-helpers";
import { AgendaTopBar, type ViewType } from "@/components/agenda/AgendaTopBar";
import { TimeGrid } from "@/components/agenda/TimeGrid";
import { MonthView } from "@/components/agenda/MonthView";
import {
  EventDetailPopover,
  type PopoverState,
} from "@/components/agenda/EventDetailPopover";
import { CreateMeetingDialog } from "@/components/agenda/CreateMeetingDialog";

// â”€â”€â”€ Google Calendar user colors (for shared calendars overlay) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const USER_COLORS = [
  "#4285F4",   // Google blue -- own
  "#10B981",   // emerald
  "#3B82F6",   // blue
  "#8B5CF6",   // violet
  "#EC4899",   // pink
  "#F97316",   // orange
  "#06B6D4",   // cyan
];

// â”€â”€â”€ Available internal sources â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const INTERNAL_SOURCES: EventSource[] = [
  "meeting",
  "follow_up",
  "scheduled_message",
  "pipe_confirmacao",
];

// â”€â”€â”€ Main component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function Agenda() {
  const { session } = useAuth();

  const [view, setView] = useState<ViewType>("day");
  const [date, setDate] = useState(new Date());
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialStart, setCreateInitialStart] = useState<Date | undefined>();

  // â”€â”€ Source visibility toggles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [activeSources, setActiveSources] = useState<Set<EventSource>>(
    () => new Set<EventSource>([...INTERNAL_SOURCES, "google"]),
  );

  const toggleSource = useCallback((source: EventSource) => {
    setActiveSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }, []);

  // â”€â”€ Google Calendar overlay data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Date range for queries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { startDate, endDate } = useMemo(() => {
    if (view === "day") {
      const s = startOfDay(date);
      return { startDate: s, endDate: addDays(s, 1) };
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

  // â”€â”€ Data: internal events (primary) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const {
    data: agendaRawEvents = [],
    isLoading: agendaLoading,
    refetch: refetchAgenda,
  } = useAgendaEvents(startDate, endDate);

  // â”€â”€ Data: Google Calendar events (optional overlay) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const {
    data: googleRawEvents,
    isLoading: googleLoading,
    refetch: refetchGoogle,
  } = useCalendarEvents(startDate, endDate);

  const isLoading = agendaLoading || googleLoading;

  // â”€â”€ Merge + filter events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const allEvents: UnifiedEvent[] = useMemo(() => {
    const internal = normalizeAgendaEvents(agendaRawEvents);
    const google =
      activeSources.has("google") && googleRawEvents
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

    return [...internal, ...deduped].filter((e) => activeSources.has(e.source));
  }, [agendaRawEvents, googleRawEvents, activeSources, googleOwnerCalendars, ownUserId]);

  // â”€â”€ Mutations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Date label â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Source toggles for the topbar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const sourceToggles = useMemo(() => {
    const sources: EventSource[] = [...INTERNAL_SOURCES];
    if (googleConnected) sources.push("google");
    return sources.map((key) => ({
      key,
      active: activeSources.has(key),
    }));
  }, [activeSources, googleConnected]);

  // â”€â”€ Event handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Top Bar */}
      <AgendaTopBar
        dateLabel={dateLabel}
        view={view}
        onViewChange={setView}
        onNavigate={navigate}
        sourceToggles={sourceToggles}
        onToggleSource={toggleSource}
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
