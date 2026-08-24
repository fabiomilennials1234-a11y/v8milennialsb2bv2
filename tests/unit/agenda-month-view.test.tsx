/**
 * Grade mensal da Agenda — a tela que o botão da lateral abre.
 *
 * Confere o que a referência pede: sete colunas com o nome do dia, o
 * compromisso desenhado DENTRO da célula do seu dia, e o responsável
 * identificável para quem enxerga a agenda da equipe inteira.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { UnifiedEvent } from "@/modules/engagement/components/agenda/agenda-helpers";
import { MonthView } from "@/modules/engagement/components/agenda/MonthView";

function evento(over: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return {
    id: "meeting-1",
    title: "Reunião",
    start: new Date(2026, 7, 3, 16, 0), // 03/08/2026 16:00 — hora local
    end: new Date(2026, 7, 3, 17, 0),
    allDay: false,
    source: "meeting",
    color: "hsl(47, 100%, 50%)",
    description: null,
    location: null,
    meetLink: null,
    leadId: null,
    leadName: null,
    leadCompany: null,
    creatorName: null,
    createdBy: null,
    status: "scheduled",
    eventType: "meeting",
    googleEventId: null,
    googleHtmlLink: null,
    googleCalendarOwnerId: null,
    googleCalendarColor: null,
    googleCalendarOwnerName: null,
    ...over,
  };
}

function renderMes(props: Partial<Parameters<typeof MonthView>[0]> = {}) {
  return render(
    <MonthView
      date={new Date(2026, 7, 24)} // agosto de 2026
      events={[]}
      onEventClick={vi.fn()}
      onSlotClick={vi.fn()}
      {...props}
    />,
  );
}

describe("MonthView", () => {
  it("desenha as sete colunas da semana", () => {
    renderMes();
    for (const dia of [
      "Domingo",
      "Segunda-feira",
      "Terça-feira",
      "Quarta-feira",
      "Quinta-feira",
      "Sexta-feira",
      "Sábado",
    ]) {
      expect(screen.getByText(dia)).toBeInTheDocument();
    }
  });

  it("mostra o compromisso com a hora, dentro do dia", () => {
    renderMes({ events: [evento({ title: "Reunião" })] });
    const pilula = screen.getByRole("button", { name: /16:00 Reunião/ });
    expect(pilula).toBeInTheDocument();
  });

  it("sem compromisso, a grade fica vazia — não quebra", () => {
    renderMes();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("identifica o responsável só quando showOwner está ligado", () => {
    const { rerender } = renderMes({
      events: [evento({ creatorName: "Ana Souza" })],
    });
    expect(screen.queryByText("AS")).not.toBeInTheDocument();

    rerender(
      <MonthView
        date={new Date(2026, 7, 24)}
        events={[evento({ creatorName: "Ana Souza" })]}
        onEventClick={vi.fn()}
        onSlotClick={vi.fn()}
        showOwner
      />,
    );
    expect(screen.getByText("AS")).toBeInTheDocument();
  });

  it("colapsa em '+N mais' quando o dia lota", () => {
    const cinco = Array.from({ length: 5 }, (_, i) =>
      evento({ id: `meeting-${i}`, title: `Evento ${i}` }),
    );
    renderMes({ events: cinco });
    expect(screen.getByText("+2 mais")).toBeInTheDocument();
  });

  it("clicar no compromisso não dispara o clique da célula", async () => {
    const onEventClick = vi.fn();
    const onSlotClick = vi.fn();
    renderMes({ events: [evento()], onEventClick, onSlotClick });

    screen.getByRole("button", { name: /16:00 Reunião/ }).click();

    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onSlotClick).not.toHaveBeenCalled();
  });

  it("a célula do dia não é <button> — botão dentro de botão é HTML inválido", () => {
    const { container } = renderMes({ events: [evento()] });
    const pilula = screen.getByRole("button", { name: /16:00 Reunião/ });
    expect(pilula.closest("button")).toBe(pilula);
    expect(container.querySelector("button button")).toBeNull();
  });

  it("marca o dia do compromisso na célula certa", () => {
    renderMes({ events: [evento({ title: "Reunião" })] });
    // A célula que contém a pílula precisa ser a do dia 3.
    const pilula = screen.getByRole("button", { name: /16:00 Reunião/ });
    const celula = pilula.parentElement?.parentElement as HTMLElement;
    expect(within(celula).getByText("3")).toBeInTheDocument();
  });
});
