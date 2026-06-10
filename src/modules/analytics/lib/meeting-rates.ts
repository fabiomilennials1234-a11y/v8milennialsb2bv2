/**
 * Taxas de conversão de reunião a partir de meeting_events (ADR-0007).
 * Pure — sem I/O. Atribuição: pre_sale_responsible_id (snapshot do evento).
 */

export interface MeetingEventLike {
  id: string;
  event_type: "meeting_booked" | "meeting_held";
  pre_sale_responsible_id: string | null;
  booked_event_id: string | null;
  occurred_at: string;
  meeting_date: string | null;
}

export interface MemberLike {
  id: string;
  name: string;
}

export interface PeriodRange {
  start: string;
  end: string;
}

export interface MeetingRate {
  id: string;
  name: string;
  meetings: number;
  sales: number;
  rate: number;
}

export function computeMeetingRates(
  events: MeetingEventLike[],
  members: MemberLike[],
  range: PeriodRange,
): MeetingRate[] {
  const start = new Date(range.start).getTime();
  const end = new Date(range.end).getTime();
  const inRange = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= start && t <= end;
  };

  const bookedInRange = events.filter(
    (e) => e.event_type === "meeting_booked" && inRange(e.occurred_at),
  );
  const heldInRange = events.filter(
    (e) => e.event_type === "meeting_held" && inRange(e.meeting_date ?? e.occurred_at),
  );

  return members.map((m) => {
    const meetings = bookedInRange.filter((e) => e.pre_sale_responsible_id === m.id).length;
    const sales = heldInRange.filter((e) => e.pre_sale_responsible_id === m.id).length;
    return {
      id: m.id,
      name: m.name,
      meetings,
      sales,
      rate: meetings > 0 ? (sales / meetings) * 100 : 0,
    };
  });
}
