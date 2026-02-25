/**
 * Página /agenda — redesenhada
 *
 * Design coeso com o sistema Torque:
 * - Topbar horizontal com navegação, seletor de view e controles
 * - Grade de horas customizada (sem react-big-calendar)
 * - Eventos como cards com borda esquerda colorida por origem
 * - Popover flutuante para detalhes (sem Sheet/Modal)
 * - Indicador de hora atual animado com ponto dourado
 * - View padrão: Dia (com Semana e Mês disponíveis)
 */

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  format,
  addHours,
  startOfWeek,
  isToday,
  isSameDay,
  addDays,
  addWeeks,
  subWeeks,
  addMonths,
  startOfMonth,
  endOfMonth,
  startOfDay,
  getHours,
  getMinutes,
  differenceInMinutes,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarDays,
  Plus,
  Video,
  ExternalLink,
  User,
  Clock,
  MapPin,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useCalendarEvents,
  type CalendarEvent,
  useGoogleCalendarStatus,
} from "@/hooks/useGoogleCalendar";
import { useCalendarSharing } from "@/hooks/useGoogleCalendarSharing";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ─── Constants ────────────────────────────────────────────────────────────────

const HOUR_HEIGHT = 64; // px per hour in time grid
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const ORIGIN_COLORS: Record<string, string> = {
  google: "#4285F4",
  calcom: "#00B4D8",
  system: "hsl(47, 100%, 50%)",
};

const ORIGIN_LABELS: Record<string, string> = {
  google: "Google",
  calcom: "Cal.com",
  system: "Sistema",
};

const USER_COLORS = [
  "hsl(47, 100%, 50%)",  // amber - próprio
  "#10B981",              // emerald
  "#3B82F6",              // blue
  "#8B5CF6",              // violet
  "#EC4899",              // pink
  "#F97316",              // orange
  "#06B6D4",              // cyan
];

const DAY_NAMES_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewType = "day" | "week" | "month";

interface AgendaEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: CalendarEvent & {
    owner_name?: string;
    color: string;
  };
}

interface NewEventForm {
  title: string;
  description: string;
  location: string;
  start_at: string;
  end_at: string;
}

interface PopoverState {
  event: AgendaEvent;
  x: number;
  y: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getEventTop(event: AgendaEvent, dayStart: Date): number {
  const minutes = differenceInMinutes(event.start, dayStart);
  return (minutes / 60) * HOUR_HEIGHT;
}

function getEventHeight(event: AgendaEvent): number {
  const duration = Math.max(differenceInMinutes(event.end, event.start), 30);
  return (duration / 60) * HOUR_HEIGHT;
}

function getNowTop(): number {
  const now = new Date();
  return (getHours(now) * 60 + getMinutes(now)) / 60 * HOUR_HEIGHT;
}

function getWeekDays(date: Date): Date[] {
  const start = startOfWeek(date, { locale: ptBR });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function getMonthGrid(date: Date): Date[] {
  const gridStart = startOfWeek(startOfMonth(date), { locale: ptBR });
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

// ─── TimeGridEvent ─────────────────────────────────────────────────────────

function TimeGridEvent({
  event,
  dayStart,
  onClick,
}: {
  event: AgendaEvent;
  dayStart: Date;
  onClick: (e: React.MouseEvent, event: AgendaEvent) => void;
}) {
  const top = getEventTop(event, dayStart);
  const height = Math.max(getEventHeight(event), 22);
  const color = event.resource.color;

  return (
    <div
      className="absolute left-1 right-1 rounded-r-md cursor-pointer overflow-hidden transition-all duration-150 hover:brightness-110 hover:shadow-md z-10"
      style={{
        top: `${top}px`,
        height: `${height}px`,
        borderLeft: `3px solid ${color}`,
        backgroundColor: `${color}1A`,
      }}
      onClick={(e) => onClick(e, event)}
    >
      <div className="px-2 py-0.5 h-full flex flex-col justify-start overflow-hidden">
        <p
          className="text-[11px] font-semibold leading-tight truncate"
          style={{ color }}
        >
          {event.title}
        </p>
        {height > 38 && (
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
            {format(event.start, "HH:mm")} – {format(event.end, "HH:mm")}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── MonthEventPill ────────────────────────────────────────────────────────

function MonthEventPill({
  event,
  onClick,
}: {
  event: AgendaEvent;
  onClick: (e: React.MouseEvent, event: AgendaEvent) => void;
}) {
  const color = event.resource.color;
  return (
    <button
      className="w-full text-left px-1.5 py-px rounded text-[10px] truncate leading-snug transition-all hover:brightness-110"
      style={{
        borderLeft: `2px solid ${color}`,
        backgroundColor: `${color}18`,
        color,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e, event);
      }}
    >
      {format(event.start, "HH:mm")} {event.title}
    </button>
  );
}

// ─── TimeGrid ─────────────────────────────────────────────────────────────

function TimeGrid({
  days,
  events,
  onEventClick,
  onSlotClick,
}: {
  days: Date[];
  events: AgendaEvent[];
  onEventClick: (e: React.MouseEvent, event: AgendaEvent) => void;
  onSlotClick: (day: Date, hour: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowTop, setNowTop] = useState(getNowTop());

  // Scroll to current time on mount
  useEffect(() => {
    if (scrollRef.current) {
      const target = Math.max(0, (new Date().getHours() - 2) * HOUR_HEIGHT);
      scrollRef.current.scrollTop = target;
    }
  }, [days.length]); // re-scroll when switching day↔week

  // Update time indicator every minute
  useEffect(() => {
    const interval = setInterval(() => setNowTop(getNowTop()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const totalHeight = HOUR_HEIGHT * 24;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Day headers */}
      <div
        className="flex border-b border-border/30 shrink-0 bg-card/30"
        style={{ paddingLeft: "52px" }}
      >
        {days.map((day) => {
          const today = isToday(day);
          return (
            <div
              key={day.toISOString()}
              className="flex-1 py-3 flex flex-col items-center gap-0.5"
            >
              <span
                className={`text-[10px] uppercase tracking-widest font-medium ${
                  today ? "text-primary" : "text-muted-foreground/50"
                }`}
              >
                {DAY_NAMES_SHORT[day.getDay()]}
              </span>
              <span
                className={`text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
                  today
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground/80 hover:bg-muted"
                }`}
              >
                {format(day, "d")}
              </span>
            </div>
          );
        })}
      </div>

      {/* Scrollable grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex relative" style={{ height: `${totalHeight}px` }}>
          {/* Hour labels */}
          <div className="w-[52px] shrink-0 relative select-none">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute w-full flex items-start justify-end pr-2.5"
                style={{ top: `${hour * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
              >
                {hour > 0 && (
                  <span className="text-[10px] text-muted-foreground/40 leading-none -mt-2">
                    {String(hour).padStart(2, "0")}:00
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const dayStart = startOfDay(day);
            const dayEvents = events.filter((e) => isSameDay(e.start, day));
            const isCurrentDay = isToday(day);

            return (
              <div
                key={day.toISOString()}
                className={`flex-1 relative border-l border-border/20 ${
                  isCurrentDay ? "bg-primary/[0.015]" : ""
                }`}
              >
                {/* Hour rows */}
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="absolute w-full border-t border-border/15 cursor-pointer hover:bg-muted/20 transition-colors"
                    style={{
                      top: `${hour * HOUR_HEIGHT}px`,
                      height: `${HOUR_HEIGHT}px`,
                    }}
                    onClick={() => onSlotClick(day, hour)}
                  />
                ))}

                {/* Half-hour lines */}
                {HOURS.map((hour) => (
                  <div
                    key={`h-${hour}`}
                    className="absolute w-full border-t border-border/8 pointer-events-none"
                    style={{ top: `${hour * HOUR_HEIGHT + HOUR_HEIGHT / 2}px` }}
                  />
                ))}

                {/* Events */}
                {dayEvents.map((event) => (
                  <TimeGridEvent
                    key={event.id}
                    event={event}
                    dayStart={dayStart}
                    onClick={onEventClick}
                  />
                ))}

                {/* Current time indicator */}
                {isCurrentDay && (
                  <div
                    className="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
                    style={{ top: `${nowTop}px` }}
                  >
                    <div className="w-2 h-2 rounded-full bg-primary shrink-0 -ml-1 shadow-sm" />
                    <div className="flex-1 h-px bg-primary/50" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── MonthView ─────────────────────────────────────────────────────────────

function MonthView({
  date,
  events,
  onEventClick,
  onSlotClick,
}: {
  date: Date;
  events: AgendaEvent[];
  onEventClick: (e: React.MouseEvent, event: AgendaEvent) => void;
  onSlotClick: (day: Date) => void;
}) {
  const days = getMonthGrid(date);
  const currentMonth = date.getMonth();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Day names header */}
      <div className="grid grid-cols-7 border-b border-border/30 bg-card/30 shrink-0">
        {DAY_NAMES_SHORT.map((name) => (
          <div
            key={name}
            className="py-2.5 text-center text-[10px] uppercase tracking-widest text-muted-foreground/50 font-medium"
          >
            {name}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div
        className="flex-1 overflow-auto"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridTemplateRows: "repeat(6, 1fr)",
        }}
      >
        {days.map((day) => {
          const isCurrentMonth = day.getMonth() === currentMonth;
          const today = isToday(day);
          const dayEvents = events.filter((e) => isSameDay(e.start, day));

          return (
            <div
              key={day.toISOString()}
              className={`border-b border-r border-border/15 p-1.5 overflow-hidden cursor-pointer transition-colors hover:bg-muted/20 min-h-[90px] ${
                !isCurrentMonth ? "opacity-30" : ""
              } ${today ? "bg-primary/[0.03]" : ""}`}
              onClick={() => onSlotClick(day)}
            >
              <div className="flex items-center justify-center mb-1">
                <span
                  className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${
                    today
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground/60"
                  }`}
                >
                  {format(day, "d")}
                </span>
              </div>
              <div className="space-y-px">
                {dayEvents.slice(0, 3).map((event) => (
                  <MonthEventPill
                    key={event.id}
                    event={event}
                    onClick={onEventClick}
                  />
                ))}
                {dayEvents.length > 3 && (
                  <p className="text-[10px] text-muted-foreground/60 pl-1 pt-px">
                    +{dayEvents.length - 3} mais
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── EventDetailPopover ────────────────────────────────────────────────────

function EventDetailPopover({
  state,
  onClose,
}: {
  state: PopoverState;
  onClose: () => void;
}) {
  const { event, x, y } = state;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 14, top: y - 16 });

  // Adjust so it doesn't overflow viewport
  useEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x + 14;
    let top = y - 16;
    if (left + width > vw - 16) left = x - width - 14;
    if (top + height > vh - 16) top = vh - height - 16;
    if (top < 8) top = 8;
    setPos({ left, top });
  }, [x, y]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  const color = event.resource.color;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.12 }}
      className="fixed z-50 w-72 bg-card border border-border/50 rounded-xl shadow-2xl overflow-hidden"
      style={{ left: pos.left, top: pos.top }}
    >
      {/* Color bar */}
      <div className="h-[3px]" style={{ backgroundColor: color }} />

      <div className="p-4 space-y-3">
        {/* Title + close */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm leading-snug flex-1 text-foreground">
            {event.title}
          </h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Origin badge */}
        <Badge
          variant="outline"
          className="text-[10px] h-5 px-2 capitalize"
          style={{
            borderColor: `${color}50`,
            color,
            backgroundColor: `${color}15`,
          }}
        >
          {ORIGIN_LABELS[event.resource.origin] ?? event.resource.origin}
        </Badge>

        {/* Time */}
        <div className="flex items-start gap-2 text-xs">
          <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground" />
          <div>
            <p className="text-foreground/90 capitalize">
              {format(event.start, "EEEE, d 'de' MMMM", { locale: ptBR })}
            </p>
            <p className="text-muted-foreground">
              {format(event.start, "HH:mm")} – {format(event.end, "HH:mm")}
            </p>
          </div>
        </div>

        {/* Owner */}
        {event.resource.owner_name && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <User className="w-3.5 h-3.5 shrink-0" />
            <span>{event.resource.owner_name}</span>
          </div>
        )}

        {/* Location */}
        {event.resource.location && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{event.resource.location}</span>
          </div>
        )}

        {/* Meet link */}
        {event.resource.meet_link && (
          <a
            href={event.resource.meet_link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            <Video className="w-3.5 h-3.5 shrink-0" />
            Entrar no Google Meet
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}

        {/* Lead link */}
        {event.resource.lead_id && (
          <a
            href={`/leads?id=${event.resource.lead_id}`}
            className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            Ver lead no sistema
          </a>
        )}

        {/* Description */}
        {event.resource.description && (
          <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-2.5 leading-relaxed">
            {event.resource.description}
          </p>
        )}
      </div>
    </motion.div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export default function Agenda() {
  const { session } = useAuth();

  const [view, setView] = useState<ViewType>("day");
  const [date, setDate] = useState(new Date());
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newEvent, setNewEvent] = useState<NewEventForm>({
    title: "",
    description: "",
    location: "",
    start_at: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    end_at: format(addHours(new Date(), 1), "yyyy-MM-dd'T'HH:mm"),
  });

  // Calendars
  const { data: status } = useGoogleCalendarStatus();
  const { data: sharingData } = useCalendarSharing();
  const ownUserId = session?.user?.id ?? "";

  const allCalendars = useMemo(() => {
    const list: Array<{ id: string; name: string; color: string; isOwn: boolean }> = [];
    if (status?.connected) {
      list.push({ id: ownUserId, name: "Meu Calendário", color: USER_COLORS[0], isOwn: true });
    }
    sharingData?.incoming?.forEach((share, idx) => {
      list.push({
        id: share.owner_id,
        name: share.owner?.name ?? "Colega",
        color: USER_COLORS[(idx + 1) % USER_COLORS.length],
        isOwn: false,
      });
    });
    return list;
  }, [status, sharingData, ownUserId]);

  const [activeCalendars, setActiveCalendars] = useState<Set<string>>(new Set());
  useEffect(() => {
    setActiveCalendars(new Set(allCalendars.map((c) => c.id)));
  }, [allCalendars.length]);

  const toggleCalendar = (id: string) => {
    setActiveCalendars((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Date range for query
  const { startDate, endDate } = useMemo(() => {
    if (view === "day") {
      const s = startOfDay(date);
      return { startDate: s, endDate: addDays(s, 1) };
    }
    if (view === "week") {
      const s = startOfWeek(date, { locale: ptBR });
      return { startDate: s, endDate: addDays(s, 7) };
    }
    return {
      startDate: new Date(date.getFullYear(), date.getMonth() - 1, 1),
      endDate: new Date(date.getFullYear(), date.getMonth() + 2, 0),
    };
  }, [date, view]);

  const { data: eventsData, isLoading, refetch } = useCalendarEvents(startDate, endDate);

  const calendarEvents: AgendaEvent[] = useMemo(() => {
    // Edge function returns raw Google API items where start/end are objects
    // { dateTime: "...", timeZone: "..." } or { date: "..." } for all-day events.
    // We need to normalize them to strings before constructing Date objects.
    type RawEvent = Record<string, unknown> & { calendar_owner_id?: string };
    const events = (eventsData ?? []) as RawEvent[];

    return events
      .filter((e) => {
        const ownerId = (e.calendar_owner_id ?? ownUserId) as string;
        const status = typeof e.status === "string" ? e.status : "";
        return activeCalendars.has(ownerId) && status !== "cancelled";
      })
      .map((e) => {
        const ownerId = (e.calendar_owner_id ?? ownUserId) as string;
        const calInfo = allCalendars.find((c) => c.id === ownerId);
        const origin = ((e.origin as string) ?? "google") as CalendarEvent["origin"];
        const color = calInfo?.color ?? ORIGIN_COLORS[origin] ?? USER_COLORS[0];

        // Normalize start/end: Google API returns objects, cache returns strings
        type DateField = { dateTime?: string; date?: string } | string | undefined;
        const toStr = (f: DateField): string => {
          if (!f) return "";
          if (typeof f === "string") return f;
          return f.dateTime ?? f.date ?? "";
        };
        const startStr = toStr(e.start as DateField);
        const endStr   = toStr(e.end   as DateField) || startStr;

        // meet_link: normalized field (from cache) or raw Google field
        const meetLink =
          (e.meet_link as string | null) ??
          (e.hangoutLink as string | null) ??
          null;

        return {
          id: e.id as string,
          title: (e.summary as string) ?? "(sem título)",
          start: new Date(startStr),
          end:   new Date(endStr),
          resource: {
            id:          e.id as string,
            summary:     (e.summary as string) ?? "(sem título)",
            description: (e.description as string | null) ?? null,
            location:    (e.location   as string | null) ?? null,
            start:       startStr,
            end:         endStr,
            status:      (e.status as string) ?? "confirmed",
            meet_link:   meetLink,
            lead_id:     (e.lead_id    as string | null) ?? null,
            origin,
            html_link:   (e.htmlLink   as string | null) ?? (e.html_link as string | null) ?? null,
            owner_name:  calInfo?.name,
            color,
          },
        } as AgendaEvent;
      });
  }, [eventsData, activeCalendars, allCalendars, ownUserId]);

  // Navigation
  const navigate = (dir: "prev" | "next" | "today") => {
    if (dir === "today") { setDate(new Date()); return; }
    const d = dir === "next" ? 1 : -1;
    if (view === "day") setDate((v) => addDays(v, d));
    else if (view === "week") setDate((v) => (d === 1 ? addWeeks(v, 1) : subWeeks(v, 1)));
    else setDate((v) => (d === 1 ? addMonths(v, 1) : addMonths(v, -1)));
  };

  // Date label
  const dateLabel = useMemo(() => {
    if (view === "day")
      return format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
    if (view === "week") {
      const days = getWeekDays(date);
      const [first, last] = [days[0], days[6]];
      if (first.getMonth() === last.getMonth())
        return `${format(first, "d")} – ${format(last, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}`;
      return `${format(first, "d MMM", { locale: ptBR })} – ${format(last, "d MMM yyyy", { locale: ptBR })}`;
    }
    return format(date, "MMMM 'de' yyyy", { locale: ptBR });
  }, [date, view]);

  const handleEventClick = useCallback((e: React.MouseEvent, event: AgendaEvent) => {
    e.stopPropagation();
    setPopover({ event, x: e.clientX, y: e.clientY });
  }, []);

  const handleSlotClick = useCallback((day: Date, hour = 9) => {
    if (!status?.connected) return;
    const slotStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour);
    setNewEvent((prev) => ({
      ...prev,
      start_at: format(slotStart, "yyyy-MM-dd'T'HH:mm"),
      end_at: format(addHours(slotStart, 1), "yyyy-MM-dd'T'HH:mm"),
    }));
    setCreateOpen(true);
  }, [status]);

  const handleCreateEvent = async () => {
    if (!newEvent.title.trim()) { toast.error("Título é obrigatório"); return; }
    if (!session?.access_token) { toast.error("Não autenticado"); return; }
    setSubmitting(true);
    try {
      const url = `${(import.meta.env.VITE_SUPABASE_URL as string ?? "").replace(/\/$/, "")}/functions/v1/google-calendar-events`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: newEvent.title,
          description: newEvent.description || undefined,
          location: newEvent.location || undefined,
          start_at: new Date(newEvent.start_at).toISOString(),
          end_at: new Date(newEvent.end_at).toISOString(),
          timezone: "America/Sao_Paulo",
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Erro ao criar evento");
      const data = await res.json();
      toast.success("Evento criado!", {
        description: data.meet_link ? "Link do Meet gerado automaticamente." : undefined,
      });
      setCreateOpen(false);
      setNewEvent({
        title: "", description: "", location: "",
        start_at: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        end_at: format(addHours(new Date(), 1), "yyyy-MM-dd'T'HH:mm"),
      });
      refetch();
    } catch (err) {
      toast.error("Erro ao criar evento", { description: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Empty state ───────────────────────────────────────────────────────────

  if (!status?.connected && allCalendars.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4"
        >
          <div className="w-16 h-16 mx-auto rounded-2xl bg-muted/50 flex items-center justify-center">
            <CalendarDays className="w-8 h-8 text-muted-foreground/40" />
          </div>
          <h2 className="text-lg font-semibold">Nenhum calendário conectado</h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            Vá em{" "}
            <a href="/configuracoes" className="text-primary underline underline-offset-2">
              Configurações → Calendário
            </a>{" "}
            e conecte seu Google Calendar para ver seus eventos aqui.
          </p>
        </motion.div>
      </div>
    );
  }

  const weekDays = view === "week" ? getWeekDays(date) : [date];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">

      {/* ── Top Bar ────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-2 px-4 py-2.5 border-b border-border/30 bg-card/40 backdrop-blur-sm shrink-0 flex-wrap"
      >
        {/* Icon + Title */}
        <div className="flex items-center gap-2 mr-1">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <CalendarDays className="w-3.5 h-3.5 text-primary" />
          </div>
          <span className="font-semibold text-sm text-foreground/90">Agenda</span>
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 rounded-lg"
            onClick={() => navigate("prev")}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs rounded-lg font-medium"
            onClick={() => navigate("today")}
          >
            Hoje
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 rounded-lg"
            onClick={() => navigate("next")}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* Date label */}
        <span className="text-sm font-medium text-foreground/70 capitalize flex-1 min-w-0 truncate">
          {dateLabel}
        </span>

        {/* Calendar toggles */}
        {allCalendars.length > 0 && (
          <div className="flex items-center gap-3">
            {allCalendars.map((cal) => (
              <button
                key={cal.id}
                onClick={() => toggleCalendar(cal.id)}
                className="flex items-center gap-1.5 text-xs transition-all duration-150"
                style={{ opacity: activeCalendars.has(cal.id) ? 1 : 0.35 }}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: cal.color }}
                />
                <span className="text-muted-foreground text-[11px]">
                  {cal.isOwn ? "Você" : cal.name}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* View switcher */}
        <div className="flex items-center bg-muted/60 rounded-lg p-0.5 gap-px">
          {(["day", "week", "month"] as ViewType[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2.5 py-1 text-[11px] rounded-md transition-all font-medium ${
                view === v
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground/80"
              }`}
            >
              {v === "day" ? "Dia" : v === "week" ? "Semana" : "Mês"}
            </button>
          ))}
        </div>

        {/* Refresh */}
        <Button
          variant="ghost"
          size="icon"
          className="w-7 h-7 rounded-lg"
          onClick={() => refetch()}
          disabled={isLoading}
          title="Atualizar"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </Button>

        {/* New Event */}
        <Button
          size="sm"
          className="gap-1.5 h-7 text-xs rounded-lg"
          onClick={() => setCreateOpen(true)}
          disabled={!status?.connected}
        >
          <Plus className="w-3.5 h-3.5" />
          Novo Evento
        </Button>
      </motion.div>

      {/* ── Calendar body ──────────────────────────────────────────────────── */}
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
              events={calendarEvents}
              onEventClick={handleEventClick}
              onSlotClick={(day) => handleSlotClick(day)}
            />
          ) : (
            <TimeGrid
              days={weekDays}
              events={calendarEvents}
              onEventClick={handleEventClick}
              onSlotClick={handleSlotClick}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* ── Event Popover ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {popover && (
          <EventDetailPopover
            state={popover}
            onClose={() => setPopover(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Create Event Dialog ─────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center">
                <Plus className="w-3.5 h-3.5 text-primary" />
              </div>
              Novo Evento
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="event-title" className="text-xs text-muted-foreground">
                Título *
              </Label>
              <Input
                id="event-title"
                placeholder="Nome do evento"
                value={newEvent.title}
                onChange={(e) => setNewEvent((p) => ({ ...p, title: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Início *</Label>
                <Input
                  type="datetime-local"
                  value={newEvent.start_at}
                  onChange={(e) => setNewEvent((p) => ({ ...p, start_at: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Fim *</Label>
                <Input
                  type="datetime-local"
                  value={newEvent.end_at}
                  onChange={(e) => setNewEvent((p) => ({ ...p, end_at: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Local</Label>
              <Input
                placeholder="Endereço ou link"
                value={newEvent.location}
                onChange={(e) => setNewEvent((p) => ({ ...p, location: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Descrição</Label>
              <Textarea
                placeholder="Notas sobre o evento..."
                rows={3}
                value={newEvent.description}
                onChange={(e) => setNewEvent((p) => ({ ...p, description: e.target.value }))}
              />
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
              <Video className="w-3.5 h-3.5 text-primary shrink-0" />
              Link do Google Meet será gerado automaticamente
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateOpen(false)}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button size="sm" onClick={handleCreateEvent} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Criando...
                  </>
                ) : (
                  "Criar Evento"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
