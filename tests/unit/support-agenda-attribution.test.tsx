import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EventDetailPopover } from "@/modules/engagement/components/agenda/EventDetailPopover";
import { DayAgendaView } from "@/modules/engagement/components/agenda/DayAgendaView";
import { MonthEventPill } from "@/modules/engagement/components/agenda/MonthEventPill";
import { AgendaProximo } from "@/modules/engagement/components/agenda/AgendaProximo";
import { agendaAttributionLabel } from "@/modules/engagement/lib/agenda-attribution";
import type { UnifiedEvent } from "@/modules/engagement/components/agenda/agenda-helpers";
import { CardProximasAgendas } from "@/modules/analytics/components/dashboard/v2/CardProximasAgendas";

vi.mock("@/modules/engagement", async () => import("@/modules/engagement/lib/agenda-attribution"));
vi.mock("@/modules/analytics/hooks/useComandoAgenda", () => ({
  useComandoAgenda: () => ({
    data: [{ id: "meeting-1", source: "meeting", title: "Futura", start_at: new Date(Date.now() + 3600000).toISOString(),
      status: "scheduled", creator_name: "Ana", owner_name: "Bruno", lead_name: "Cliente" }],
    isLoading: false, isError: false, isAdmin: true, refetch: vi.fn(),
  }),
}));

const event: UnifiedEvent = {
  id: "meeting-1", source: "meeting", title: "Conversa com cliente",
  start: new Date(Date.now() + 3600000), end: new Date(Date.now() + 7200000),
  allDay: false, color: "hsl(47, 100%, 50%)", description: null, location: null, meetLink: null,
  leadId: "lead-1", leadName: "Cliente", leadCompany: null,
  creatorName: "Ana", createdBy: "user-ana", status: "scheduled", eventType: "meeting",
  googleEventId: null, googleHtmlLink: null, googleCalendarOwnerId: null,
  googleCalendarColor: null, googleCalendarOwnerName: null,
};
const props = { state: { event, x: 200, y: 200 }, onClose: vi.fn(), onDeleteMeeting: vi.fn(), onDeleteGoogleEvent: vi.fn() };

describe("autoria da agenda e responsabilidade comercial", () => {
  it("reatribuição atualiza os papéis sem trocar quem agendou", () => {
    const { rerender } = render(<EventDetailPopover {...props} leadResponsibles={{ preSaleName: "Bruno", saleName: "Carla" }} />);
    expect(screen.getByText("Agendado por: Ana")).toBeInTheDocument();
    expect(screen.getByText("Pré-venda atual: Bruno")).toBeInTheDocument();
    expect(screen.getByText("Venda atual: Carla")).toBeInTheDocument();
    rerender(<EventDetailPopover {...props} leadResponsibles={{ preSaleName: "Dora", saleName: null }} />);
    expect(screen.getByText("Agendado por: Ana")).toBeInTheDocument();
    expect(screen.getByText("Pré-venda atual: Dora")).toBeInTheDocument();
    expect(screen.getByText("Venda atual: Sem responsável")).toBeInTheDocument();
    expect(screen.queryByText("Pré-venda atual: Bruno")).not.toBeInTheDocument();
  });
  it("erro e carregamento não fingem que o lead está sem responsável", () => {
    const { rerender } = render(<EventDetailPopover {...props} leadResponsiblesLoading />);
    expect(screen.getByText("Carregando responsáveis do lead…")).toBeInTheDocument();
    rerender(<EventDetailPopover {...props} leadResponsiblesError />);
    expect(screen.getByText("Responsáveis do lead indisponíveis.")).toBeInTheDocument();
    expect(screen.queryByText(/atual: Sem responsável/)).not.toBeInTheDocument();
  });
  it("Dia, Mês e Próximo compromisso rotulam a autoria", () => {
    const { unmount } = render(<DayAgendaView date={event.start} events={[event]} showOwner onEventClick={vi.fn()} onSelectDate={vi.fn()} />);
    expect(screen.getByText(/Agendado por: Ana/)).toBeInTheDocument();
    unmount();
    const month = render(<MonthEventPill event={event} showOwner onClick={vi.fn()} />);
    expect(screen.getByRole("button").title).toContain("Agendado por: Ana");
    expect(screen.getByRole("button").title).not.toContain("Responsável:");
    month.unmount();
    render(<MemoryRouter><AgendaProximo events={[event]} onEventClick={vi.fn()} googleConnected={false} /></MemoryRouter>);
    expect(screen.getByText("Agendado por")).toBeInTheDocument();
    expect(screen.queryByText("Responsável")).not.toBeInTheDocument();
  });
  it("não rotula o responsável por follow-up nem o dono de calendário como criador", () => {
    expect(agendaAttributionLabel("follow_up")).toBe("Responsável");
    expect(agendaAttributionLabel("google")).toBe("Agenda");
    expect(agendaAttributionLabel("scheduled_message")).toBe("Agendado por");
  });
  it("Comando mostra quem agendou, mesmo se o dono normalizado for outra pessoa", () => {
    render(<MemoryRouter><CardProximasAgendas /></MemoryRouter>);
    expect(screen.getByText(/Agendado por: Ana/)).toBeInTheDocument();
    expect(screen.queryByText(/Agendado por: Bruno/)).not.toBeInTheDocument();
  });
});
