import { describe, it, expect } from "vitest";
import { computeMeetingRates } from "@/modules/analytics/lib/meeting-rates";

const range = { start: "2026-06-01T00:00:00Z", end: "2026-06-30T23:59:59Z" };
const joao = { id: "joao", name: "João" };

let seq = 0;
function booked(presale: string | null, occurredAt: string, meetingDate?: string) {
  return {
    id: `ev-${seq++}`,
    event_type: "meeting_booked" as const,
    pre_sale_responsible_id: presale,
    booked_event_id: null,
    occurred_at: occurredAt,
    meeting_date: meetingDate ?? null,
  };
}

function held(presale: string | null, bookedEventId: string | null, meetingDate: string, occurredAt?: string) {
  return {
    id: `ev-${seq++}`,
    event_type: "meeting_held" as const,
    pre_sale_responsible_id: presale,
    booked_event_id: bookedEventId,
    occurred_at: occurredAt ?? meetingDate,
    meeting_date: meetingDate,
  };
}

describe("computeMeetingRates", () => {
  it("conta reunião marcada no período pro pré-vendas do evento", () => {
    const events = [booked("joao", "2026-06-10T12:00:00Z")];

    const rates = computeMeetingRates(events, [joao], range);

    expect(rates).toEqual([
      { id: "joao", name: "João", meetings: 1, sales: 0, rate: 0 },
    ]);
  });

  it("reunião realizada conta no período da data da reunião e entra na taxa", () => {
    const b1 = booked("joao", "2026-06-05T10:00:00Z", "2026-06-12T14:00:00Z");
    const b2 = booked("joao", "2026-06-06T10:00:00Z", "2026-06-20T14:00:00Z");
    const events = [b1, b2, held("joao", b1.id, "2026-06-12T14:00:00Z")];

    const rates = computeMeetingRates(events, [joao], range);

    expect(rates).toEqual([
      { id: "joao", name: "João", meetings: 2, sales: 1, rate: 50 },
    ]);
  });

  it("marcada fora do período não conta; realizada segue a data da reunião, não a do clique", () => {
    const maioBooked = booked("joao", "2026-05-20T10:00:00Z", "2026-05-25T14:00:00Z");
    // reunião marcada em maio pra julho — held registrado em junho (clique), reunião em julho
    const julhoBooked = booked("joao", "2026-05-28T10:00:00Z", "2026-07-02T14:00:00Z");
    const events = [
      maioBooked,
      julhoBooked,
      held("joao", julhoBooked.id, "2026-07-02T14:00:00Z", "2026-06-15T09:00:00Z"),
    ];

    const rates = computeMeetingRates(events, [joao], range);

    expect(rates).toEqual([
      { id: "joao", name: "João", meetings: 0, sales: 0, rate: 0 },
    ]);
  });

  it("não credita evento de outro pré-vendas nem de evento sem atribuição", () => {
    const events = [
      booked("maria", "2026-06-10T12:00:00Z"),
      booked(null, "2026-06-11T12:00:00Z"),
    ];

    const rates = computeMeetingRates(events, [joao], range);

    expect(rates).toEqual([
      { id: "joao", name: "João", meetings: 0, sales: 0, rate: 0 },
    ]);
  });
});
