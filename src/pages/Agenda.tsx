/**
 * Página /agenda
 *
 * Calendário da equipe com eventos do Google Calendar (próprio + compartilhados)
 * e eventos do Cal.com (via cache local).
 *
 * Funcionalidades:
 * - Visão dia / semana / mês
 * - Sidebar com checkboxes para ativar/desativar cada calendário
 * - Cores diferentes por usuário
 * - Clique em evento → modal de detalhes (com link para lead e Meet)
 * - Botão "Novo Evento" → modal de criação
 * - Badge de origem: Google / Cal.com / Sistema
 *
 * Requer: npm install react-big-calendar @types/react-big-calendar
 */

import { useState, useCallback, useMemo } from "react";
import { Calendar, dateFnsLocalizer, Views, type Event as RBCEvent, type View } from "react-big-calendar";
import { format, parse, startOfWeek, getDay, addHours } from "date-fns";
import { ptBR } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import {
  CalendarDays,
  Plus,
  Video,
  ExternalLink,
  User,
  Clock,
  MapPin,
  RefreshCw,
  Calendar as CalIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCalendarEvents, type CalendarEvent } from "@/hooks/useGoogleCalendar";
import { useCalendarSharing } from "@/hooks/useGoogleCalendarSharing";
import { useGoogleCalendarStatus } from "@/hooks/useGoogleCalendar";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// ─── date-fns localizer para react-big-calendar ──────────────────────────────

const locales = { "pt-BR": ptBR };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: ptBR }),
  getDay,
  locales,
});

// ─── Constantes de cores por usuário ────────────────────────────────────────

const USER_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#f59e0b", // amber
  "#10b981", // emerald
  "#3b82f6", // blue
  "#ef4444", // red
];

const ORIGIN_COLORS: Record<string, string> = {
  google: "#4285F4",
  calcom: "#00B4D8",
  system: "#6366f1",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgendaEvent extends RBCEvent {
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
  timezone: string;
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function Agenda() {
  const { session } = useAuth();
  const [view, setView]         = useState<View>(Views.WEEK);
  const [date, setDate]         = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<AgendaEvent | null>(null);
  const [createOpen, setCreateOpen]       = useState(false);
  const [newEvent, setNewEvent]           = useState<NewEventForm>({
    title:       "",
    description: "",
    location:    "",
    start_at:    format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    end_at:      format(addHours(new Date(), 1), "yyyy-MM-dd'T'HH:mm"),
    timezone:    "America/Sao_Paulo",
  });
  const [submitting, setSubmitting] = useState(false);

  // Calendários ativos (own + shared)
  const { data: status }       = useGoogleCalendarStatus();
  const { data: sharingData }  = useCalendarSharing();
  const ownUserId              = session?.user?.id ?? "";

  // Monta a lista de calendários visíveis (próprio + quem compartilhou comigo)
  const allCalendars = useMemo(() => {
    const list: Array<{ id: string; name: string; color: string; isOwn: boolean }> = [];

    if (status?.connected) {
      list.push({
        id:     ownUserId,
        name:   "Meu Calendário",
        color:  USER_COLORS[0],
        isOwn:  true,
      });
    }

    sharingData?.incoming?.forEach((share, idx) => {
      list.push({
        id:    share.owner_id,
        name:  share.owner?.name ?? "Colega",
        color: USER_COLORS[(idx + 1) % USER_COLORS.length],
        isOwn: false,
      });
    });

    return list;
  }, [status, sharingData, ownUserId]);

  const [activeCalendars, setActiveCalendars] = useState<Set<string>>(
    () => new Set(allCalendars.map((c) => c.id))
  );

  const toggleCalendar = (id: string) => {
    setActiveCalendars((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Range de datas para busca baseado na view atual
  const { startDate, endDate } = useMemo(() => {
    const d = date;
    if (view === Views.DAY) {
      return {
        startDate: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
        endDate:   new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
      };
    }
    if (view === Views.WEEK) {
      const start = startOfWeek(d, { locale: ptBR });
      return {
        startDate: start,
        endDate:   new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000),
      };
    }
    // MONTH
    return {
      startDate: new Date(d.getFullYear(), d.getMonth() - 1, 1),
      endDate:   new Date(d.getFullYear(), d.getMonth() + 2, 0),
    };
  }, [date, view]);

  const { data: eventsData, isLoading, refetch } = useCalendarEvents(startDate, endDate);

  // Converte eventos para o formato do react-big-calendar
  const calendarEvents: AgendaEvent[] = useMemo(() => {
    const events = (eventsData ?? []) as Array<CalendarEvent & { calendar_owner_id?: string }>;

    return events
      .filter((e) => {
        const ownerId = e.calendar_owner_id ?? ownUserId;
        return (
          activeCalendars.has(ownerId) &&
          e.google_event_status !== "cancelled"
        );
      })
      .map((e) => {
        const ownerId  = e.calendar_owner_id ?? ownUserId;
        const calInfo  = allCalendars.find((c) => c.id === ownerId);
        const color    = calInfo?.color ?? ORIGIN_COLORS[e.origin] ?? "#6366f1";
        const ownerName = calInfo?.name;

        return {
          id:       e.id,
          title:    e.summary ?? "(sem título)",
          start:    new Date(e.start),
          end:      new Date(e.end ?? e.start),
          resource: {
            ...e,
            owner_name: ownerName,
            color,
          },
        } as AgendaEvent;
      });
  }, [eventsData, activeCalendars, allCalendars, ownUserId]);

  // Estilo de evento customizado
  const eventStyleGetter = useCallback((event: AgendaEvent) => {
    return {
      style: {
        backgroundColor: event.resource.color,
        borderColor:     event.resource.color,
        opacity:         0.9,
        color:           "#fff",
        borderRadius:    "6px",
        border:          "none",
        padding:         "2px 6px",
        fontSize:        "12px",
      },
    };
  }, []);

  // Criação de novo evento
  const handleCreateEvent = async () => {
    if (!newEvent.title.trim()) {
      toast.error("Título é obrigatório");
      return;
    }
    if (!session?.access_token) {
      toast.error("Não autenticado");
      return;
    }

    setSubmitting(true);
    try {
      const SUPABASE_FUNCTIONS_URL = `${(import.meta.env.VITE_SUPABASE_URL as string ?? "").replace(/\/$/, "")}/functions/v1`;

      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/google-calendar-events`, {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title:       newEvent.title,
          description: newEvent.description || undefined,
          location:    newEvent.location || undefined,
          start_at:    new Date(newEvent.start_at).toISOString(),
          end_at:      new Date(newEvent.end_at).toISOString(),
          timezone:    newEvent.timezone,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message ?? "Erro ao criar evento");
      }

      const data = await res.json();
      toast.success("Evento criado!", {
        description: data.meet_link
          ? "Link do Meet gerado automaticamente."
          : undefined,
      });

      setCreateOpen(false);
      setNewEvent({
        title:       "",
        description: "",
        location:    "",
        start_at:    format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        end_at:      format(addHours(new Date(), 1), "yyyy-MM-dd'T'HH:mm"),
        timezone:    "America/Sao_Paulo",
      });
      refetch();
    } catch (err) {
      toast.error("Erro ao criar evento", {
        description: (err as Error).message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (!status?.connected && allCalendars.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-4">
          <CalendarDays className="w-16 h-16 mx-auto text-muted-foreground opacity-40" />
          <h2 className="text-xl font-semibold">Nenhum calendário conectado</h2>
          <p className="text-muted-foreground max-w-sm">
            Vá em{" "}
            <a href="/configuracoes" className="text-primary underline">
              Configurações → Calendário
            </a>{" "}
            e conecte seu Google Calendar para ver seus eventos aqui.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* ── Sidebar de calendários ────────────────────────────────────────── */}
      <aside className="w-56 shrink-0 border-r bg-card p-4 space-y-4 overflow-y-auto">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Calendários</span>
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6"
            onClick={() => refetch()}
            title="Atualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="space-y-2">
          {allCalendars.map((cal) => (
            <div key={cal.id} className="flex items-center gap-2">
              <Checkbox
                id={`cal-${cal.id}`}
                checked={activeCalendars.has(cal.id)}
                onCheckedChange={() => toggleCalendar(cal.id)}
                style={{ accentColor: cal.color }}
              />
              <Label
                htmlFor={`cal-${cal.id}`}
                className="text-xs cursor-pointer flex items-center gap-1.5"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: cal.color }}
                />
                <span className="truncate">{cal.name}</span>
                {cal.isOwn && (
                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                    você
                  </Badge>
                )}
              </Label>
            </div>
          ))}
        </div>

        <div className="pt-2 border-t">
          <Button
            size="sm"
            className="w-full gap-1.5 h-8 text-xs"
            onClick={() => setCreateOpen(true)}
            disabled={!status?.connected}
          >
            <Plus className="w-3.5 h-3.5" />
            Novo Evento
          </Button>
        </div>

        {/* Legenda de origens */}
        <div className="pt-2 border-t space-y-1.5">
          <span className="text-[11px] text-muted-foreground font-medium">Origem</span>
          {Object.entries(ORIGIN_COLORS).map(([origin, color]) => (
            <div key={origin} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[11px] text-muted-foreground capitalize">{origin}</span>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Área do calendário ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden p-4">
        <Calendar<AgendaEvent>
          localizer={localizer}
          events={calendarEvents}
          view={view}
          onView={setView}
          date={date}
          onNavigate={setDate}
          eventPropGetter={eventStyleGetter}
          onSelectEvent={(event) => setSelectedEvent(event)}
          onSelectSlot={(slot) => {
            if (!status?.connected) return;
            setNewEvent((prev) => ({
              ...prev,
              start_at: format(slot.start, "yyyy-MM-dd'T'HH:mm"),
              end_at:   format(
                slot.end ?? addHours(slot.start, 1),
                "yyyy-MM-dd'T'HH:mm"
              ),
            }));
            setCreateOpen(true);
          }}
          selectable
          messages={{
            next:      "Próximo",
            previous:  "Anterior",
            today:     "Hoje",
            month:     "Mês",
            week:      "Semana",
            day:       "Dia",
            agenda:    "Agenda",
            date:      "Data",
            time:      "Hora",
            event:     "Evento",
            noEventsInRange: "Nenhum evento neste período.",
            showMore:  (count) => `+${count} mais`,
          }}
          culture="pt-BR"
          style={{ height: "100%" }}
          className="rbc-agenda-custom"
        />
      </div>

      {/* ── Modal: detalhes do evento ─────────────────────────────────────── */}
      <Sheet
        open={!!selectedEvent}
        onOpenChange={(open) => !open && setSelectedEvent(null)}
      >
        <SheetContent side="right" className="w-96 overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <CalIcon className="w-4 h-4 text-primary" />
              {selectedEvent?.title}
            </SheetTitle>
          </SheetHeader>

          {selectedEvent && (
            <div className="mt-4 space-y-4">
              {/* Origem */}
              <Badge
                style={{
                  backgroundColor:
                    ORIGIN_COLORS[selectedEvent.resource.origin] + "20",
                  color: ORIGIN_COLORS[selectedEvent.resource.origin],
                  borderColor:
                    ORIGIN_COLORS[selectedEvent.resource.origin] + "40",
                }}
                variant="outline"
                className="capitalize"
              >
                {selectedEvent.resource.origin}
              </Badge>

              {/* Dono do calendário */}
              {selectedEvent.resource.owner_name && (
                <div className="flex items-center gap-2 text-sm">
                  <User className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span>{selectedEvent.resource.owner_name}</span>
                </div>
              )}

              {/* Horário */}
              <div className="flex items-start gap-2 text-sm">
                <Clock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p>
                    {format(selectedEvent.start, "dd 'de' MMMM 'de' yyyy", {
                      locale: ptBR,
                    })}
                  </p>
                  <p className="text-muted-foreground">
                    {format(selectedEvent.start, "HH:mm")} –{" "}
                    {format(selectedEvent.end, "HH:mm")}
                  </p>
                </div>
              </div>

              {/* Local */}
              {selectedEvent.resource.location && (
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  <span>{selectedEvent.resource.location}</span>
                </div>
              )}

              {/* Link do Meet */}
              {selectedEvent.resource.meet_link && (
                <a
                  href={selectedEvent.resource.meet_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <Video className="w-4 h-4" />
                  Entrar no Google Meet
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}

              {/* Link para o lead */}
              {selectedEvent.resource.lead_id && (
                <a
                  href={`/leads?id=${selectedEvent.resource.lead_id}`}
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="w-4 h-4" />
                  Ver lead no sistema
                </a>
              )}

              {/* Descrição */}
              {selectedEvent.resource.description && (
                <div className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/30">
                  {selectedEvent.resource.description}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Modal: criar evento ───────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Novo Evento
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="event-title" className="text-xs">Título *</Label>
              <Input
                id="event-title"
                placeholder="Nome do evento"
                value={newEvent.title}
                onChange={(e) => setNewEvent((p) => ({ ...p, title: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="start-at" className="text-xs">Início *</Label>
                <Input
                  id="start-at"
                  type="datetime-local"
                  value={newEvent.start_at}
                  onChange={(e) => setNewEvent((p) => ({ ...p, start_at: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end-at" className="text-xs">Fim *</Label>
                <Input
                  id="end-at"
                  type="datetime-local"
                  value={newEvent.end_at}
                  onChange={(e) => setNewEvent((p) => ({ ...p, end_at: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-location" className="text-xs">Local</Label>
              <Input
                id="event-location"
                placeholder="Endereço ou link"
                value={newEvent.location}
                onChange={(e) => setNewEvent((p) => ({ ...p, location: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-desc" className="text-xs">Descrição</Label>
              <Textarea
                id="event-desc"
                placeholder="Notas sobre o evento..."
                rows={3}
                value={newEvent.description}
                onChange={(e) => setNewEvent((p) => ({ ...p, description: e.target.value }))}
              />
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Video className="w-3.5 h-3.5 text-primary" />
              Link do Google Meet será gerado automaticamente
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button onClick={handleCreateEvent} disabled={submitting}>
                {submitting ? "Criando..." : "Criar Evento"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
