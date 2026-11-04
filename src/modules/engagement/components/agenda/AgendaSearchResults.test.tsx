/**
 * Os quatro estados do painel de resultados da busca da Agenda e o clique.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgendaSearchResults } from "./AgendaSearchResults";
import { normalizeAgendaEvents } from "./agenda-helpers";

const AGORA = new Date("2026-10-26T12:00:00Z");

function ev(id: string, title: string, start: string) {
  return {
    id,
    source: "meeting" as const,
    title,
    description: null,
    start_at: start,
    end_at: start,
    all_day: false,
    event_type: "meeting",
    status: "scheduled",
    lead_id: "l1",
    lead_name: "Padaria Estrela",
    lead_company: "Estrela Pães",
    created_by: null,
    creator_name: null,
    location: null,
    meet_link: null,
    color: null,
    google_event_id: null,
  };
}

const base = {
  term: "estrela",
  events: [],
  isPending: false,
  isError: false,
  onRetry: vi.fn(),
  onEventClick: vi.fn(),
  now: AGORA,
};

describe("AgendaSearchResults", () => {
  it("termo curto: pede mais caracteres", () => {
    render(<AgendaSearchResults {...base} term="e" />);
    expect(screen.getByText("Continue digitando")).toBeInTheDocument();
  });

  it("carregando: mostra o status, não o vazio", () => {
    render(<AgendaSearchResults {...base} isPending />);
    expect(screen.getByRole("status")).toHaveTextContent("Buscando");
    expect(screen.queryByText(/Nada marcado/)).toBeNull();
  });

  it("vazio explícito com o termo", () => {
    render(<AgendaSearchResults {...base} term="Zzz" />);
    expect(screen.getByText("Nada marcado para “Zzz”")).toBeInTheDocument();
  });

  it("erro: alerta com nova tentativa, sem fingir que está vazio", async () => {
    const onRetry = vi.fn();
    render(<AgendaSearchResults {...base} isError onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível buscar na agenda.");
    expect(screen.queryByText(/Nada marcado/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("função ausente: mensagem própria", () => {
    render(<AgendaSearchResults {...base} isError isUnavailable />);
    expect(screen.getByRole("alert")).toHaveTextContent("A busca ainda não está disponível.");
  });

  it("separa próximos de anteriores, mostra a data e entrega o evento no clique", async () => {
    const onEventClick = vi.fn();
    const events = normalizeAgendaEvents([
      ev("a", "Renovação anual", "2027-11-30T15:00:00Z"),
      ev("b", "Primeira visita", "2024-08-01T15:00:00Z"),
    ]);
    render(<AgendaSearchResults {...base} events={events} onEventClick={onEventClick} />);

    expect(screen.getByRole("region", { name: "Próximos" })).toHaveTextContent("Renovação anual");
    expect(screen.getByRole("region", { name: "Anteriores" })).toHaveTextContent("Primeira visita");
    // A data por extenso, com ano: o resultado não tem janela.
    expect(screen.getByText(/2024/)).toBeInTheDocument();
    expect(screen.getByText("2 compromissos")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Primeira visita/ }));
    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick.mock.calls[0][1].title).toBe("Primeira visita");
  });
});
