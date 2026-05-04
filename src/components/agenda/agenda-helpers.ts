/**
 * Agenda layout helpers and constants.
 *
 * Pure functions extracted from the original Agenda.tsx monolith.
 * No React imports — these are reusable across all calendar views.
 */

import {
  differenceInMinutes,
  startOfWeek,
  startOfMonth,
  addDays,
  getHours,
  getMinutes,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import type { AgendaEvent as RpcAgendaEvent } from "@/hooks/useAgendaEvents";
import type { CalendarEvent } from "@/hooks/useGoogleCalendar";

// ─── Constants ────────────────────────────────────────────────────────────────

export const HOUR_HEIGHT = 64; // px per hour in time grid
export const HOURS = Array.from({ length: 24 }, (_, i) => i);
export const DAY_NAMES_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Source → colour mapping for the unified agenda. */
export const SOURCE_COLORS: Record<string, string> = {
  meeting: "hsl(47, 100%, 50%)",      // gold (primary brand)
  follow_up: "#10B981",                // emerald
  scheduled_message: "#3B82F6",        // blue
  pipe_confirmacao: "#8B5CF6",         // violet
  google: "#4285F4",                   // Google blue (overlay)
};

/** Human-readable source labels (pt-BR). */
export const SOURCE_LABELS: Record<string, string> = {
  meeting: "Reunião",
  follow_up: "Follow-up",
  scheduled_message: "Mensagem Agendada",
  pipe_confirmacao: "Confirmação",
  google: "Google Calendar",
};

/** Google Calendar event colorId → hex. */
export const GOOGLE_EVENT_COLORS: Record<string, string> = {
  "1": "#7986CB",
  "2": "#33B679",
  "3": "#8E24AA",
  "4": "#E67C73",
  "5": "#F6BF26",
  "6": "#F4511E",
  "7": "#039BE5",
  "8": "#3F51B5",
  "9": "#0B8043",
  "10": "#D50000",
  "11": "#616161",
};

// ─── Unified event type ───────────────────────────────────────────────────────

export type EventSource = "meeting" | "follow_up" | "scheduled_message" | "pipe_confirmacao" | "google";

export interface UnifiedEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  source: EventSource;
  color: string;
  // Extra fields carried through for the popover
  description: string | null;
  location: string | null;
  meetLink: string | null;
  leadId: string | null;
  leadName: string | null;
  leadCompany: string | null;
  creatorName: string | null;
  status: string;
  eventType: string;
  googleEventId: string | null;
  /** Original Google Calendar event fields for overlay events */
  googleHtmlLink: string | null;
  /** Owner of a shared Google calendar (only for google source) */
  googleCalendarOwnerId: string | null;
  googleCalendarOwnerName: string | null;
  googleCalendarColor: string | null;
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

export function getEventTop(event: UnifiedEvent, dayStart: Date): number {
  const minutes = differenceInMinutes(event.start, dayStart);
  return (minutes / 60) * HOUR_HEIGHT;
}

export function getEventHeight(event: UnifiedEvent): number {
  const duration = Math.max(differenceInMinutes(event.end, event.start), 30);
  return (duration / 60) * HOUR_HEIGHT;
}

/**
 * Greedy interval-graph colouring for side-by-side overlap layout.
 *
 * Events that don't overlap get full width; overlapping events share width
 * equally. Returns a map of eventId -> { left, width } as fractions (0-1).
 */
export function computeEventLayout(
  events: UnifiedEvent[],
): Map<string, { left: number; width: number }> {
  const result = new Map<string, { left: number; width: number }>();
  if (events.length === 0) return result;

  const sorted = [...events].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );

  // Group into transitive overlap clusters
  const clusters: UnifiedEvent[][] = [];
  let cluster: UnifiedEvent[] = [];
  let clusterMaxEnd = new Date(0);

  for (const event of sorted) {
    if (cluster.length === 0 || event.start < clusterMaxEnd) {
      cluster.push(event);
      if (event.end > clusterMaxEnd) clusterMaxEnd = event.end;
    } else {
      clusters.push(cluster);
      cluster = [event];
      clusterMaxEnd = event.end;
    }
  }
  if (cluster.length > 0) clusters.push(cluster);

  // Greedy column allocation within each cluster
  for (const clusterEvents of clusters) {
    const colEnds: Date[] = [];
    const eventCols = new Map<string, number>();

    for (const event of clusterEvents) {
      let placed = false;
      for (let i = 0; i < colEnds.length; i++) {
        if (colEnds[i] <= event.start) {
          colEnds[i] = event.end;
          eventCols.set(event.id, i);
          placed = true;
          break;
        }
      }
      if (!placed) {
        eventCols.set(event.id, colEnds.length);
        colEnds.push(event.end);
      }
    }

    const totalCols = colEnds.length;
    for (const event of clusterEvents) {
      const col = eventCols.get(event.id)!;
      result.set(event.id, { left: col / totalCols, width: 1 / totalCols });
    }
  }

  return result;
}

export function getNowTop(): number {
  const now = new Date();
  return ((getHours(now) * 60 + getMinutes(now)) / 60) * HOUR_HEIGHT;
}

export function getWeekDays(date: Date): Date[] {
  const start = startOfWeek(date, { locale: ptBR });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function getMonthGrid(date: Date): Date[] {
  const gridStart = startOfWeek(startOfMonth(date), { locale: ptBR });
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

// ─── Data normalizers ─────────────────────────────────────────────────────────

/** Convert RPC AgendaEvent[] into our unified shape. */
export function normalizeAgendaEvents(events: RpcAgendaEvent[]): UnifiedEvent[] {
  return events.map((e) => {
    const source = e.source as EventSource;
    const color = e.color ?? SOURCE_COLORS[source] ?? SOURCE_COLORS.meeting;
    const startDate = new Date(e.start_at);
    const endDate = e.end_at
      ? new Date(e.end_at)
      : new Date(startDate.getTime() + 30 * 60_000); // default 30min

    return {
      id: `${source}-${e.id}`,
      title: e.title,
      start: startDate,
      end: endDate,
      allDay: e.all_day,
      source,
      color,
      description: e.description,
      location: e.location,
      meetLink: e.meet_link,
      leadId: e.lead_id,
      leadName: e.lead_name,
      leadCompany: e.lead_company,
      creatorName: e.creator_name,
      status: e.status,
      eventType: e.event_type,
      googleEventId: e.google_event_id,
      googleHtmlLink: null,
      googleCalendarOwnerId: null,
      googleCalendarOwnerName: null,
      googleCalendarColor: null,
    };
  });
}

/** Convert Google Calendar overlay events into our unified shape. */
export function normalizeGoogleEvents(
  events: unknown[],
  ownerCalendars: Array<{ id: string; name: string; color: string }>,
  ownUserId: string,
): UnifiedEvent[] {
  type RawEvent = Record<string, unknown> & { calendar_owner_id?: string };
  return (events as RawEvent[])
    .filter((e) => {
      const status = typeof e.status === "string" ? e.status : "";
      return status !== "cancelled";
    })
    .map((e) => {
      const ownerId = (e.calendar_owner_id ?? ownUserId) as string;
      const calInfo = ownerCalendars.find((c) => c.id === ownerId);

      // Normalize date fields (Google API objects vs cached strings)
      type DateField = { dateTime?: string; date?: string } | string | undefined;
      const toStr = (f: DateField): string => {
        if (!f) return "";
        if (typeof f === "string") return f;
        return f.dateTime ?? f.date ?? "";
      };

      const startStr = toStr(e.start as DateField);
      const endStr = toStr(e.end as DateField) || startStr;
      const isAllDay = !!(
        typeof e.start === "object" &&
        e.start &&
        "date" in e.start &&
        !("dateTime" in e.start)
      );

      const googleColorId = e.colorId as string | undefined;
      const googleColor = googleColorId ? GOOGLE_EVENT_COLORS[googleColorId] : null;
      const color = googleColor ?? calInfo?.color ?? SOURCE_COLORS.google;

      const meetLink =
        (e.meet_link as string | null) ??
        (e.hangoutLink as string | null) ??
        null;

      return {
        id: `google-${e.id as string}`,
        title: (e.summary as string) ?? "(sem titulo)",
        start: new Date(startStr),
        end: new Date(endStr),
        allDay: isAllDay,
        source: "google" as EventSource,
        color,
        description: (e.description as string | null) ?? null,
        location: (e.location as string | null) ?? null,
        meetLink,
        leadId: (e.lead_id as string | null) ?? null,
        leadName: null,
        leadCompany: null,
        creatorName: calInfo?.name ?? null,
        status: (e.status as string) ?? "confirmed",
        eventType: "google",
        googleEventId: (e.id as string) ?? null,
        googleHtmlLink:
          (e.htmlLink as string | null) ??
          (e.html_link as string | null) ??
          null,
        googleCalendarOwnerId: ownerId,
        googleCalendarOwnerName: calInfo?.name ?? null,
        googleCalendarColor: calInfo?.color ?? null,
      };
    });
}
