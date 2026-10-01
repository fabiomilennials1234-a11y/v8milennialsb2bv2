import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({
    attributes: {}, listeners: {},
    setNodeRef: vi.fn(), transform: null, transition: undefined, isDragging: false,
  }),
}));

import { DraggableKanbanBoard, type KanbanColumn } from "@/modules/pipelines/components/kanban/DraggableKanbanBoard";

interface Card {
  id: string;
  outcome?: "won" | "lost" | null;
  closedAt?: string | null;
  value?: number | null;
}

const local = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).toISOString();

const grouping = {
  outcomeOf: (c: Card) => c.outcome,
  closedAtOf: (c: Card) => c.closedAt,
  amountOf: (c: Card) => c.value,
};

function mount(column: Partial<KanbanColumn<Card>> & { items: Card[] }) {
  return render(
    <DraggableKanbanBoard<Card>
      columns={[{ id: "vendido", title: "Vendido", color: "green", ...column }]}
      onStatusChange={vi.fn()}
      renderCard={(card) => <div data-testid="card">{card.id}</div>}
      closedGrouping={grouping}
    />,
  );
}

const cards = () => screen.queryAllByTestId("card").map((el) => el.textContent);

const ITEMS: Card[] = [
  { id: "aberto-1" },
  { id: "set-a", outcome: "won", closedAt: local(2026, 9, 5), value: 1000 },
  { id: "set-b", outcome: "won", closedAt: local(2026, 9, 18), value: 500 },
  { id: "ago-a", outcome: "won", closedAt: local(2026, 8, 10), value: 200 },
  { id: "perdido-1", outcome: "lost", closedAt: local(2026, 9, 1) },
];

describe("Coluna com negócios encerrados", () => {
  it("empilha ganhos e perdidos e deixa só os abertos soltos", () => {
    mount({ items: ITEMS });
    expect(cards()).toEqual(["aberto-1"]);
    const won = screen.getByTestId("closed-stack-won");
    expect(won).toHaveTextContent("3");
    expect(won).toHaveTextContent("ganhos");
    expect(won).toHaveTextContent("R$ 1.700");
    expect(won).toHaveTextContent("2 meses");
    expect(screen.getByTestId("closed-stack-lost")).toHaveTextContent("1");
  });

  it("abre em meses; abrir um segundo mês mantém o primeiro; Agrupar volta ao baralho", () => {
    mount({ items: ITEMS });
    fireEvent.click(screen.getByTestId("closed-stack-won"));

    const group = screen.getByTestId("closed-group-won");
    // Meses listados, mais recente primeiro, ainda sem cards.
    const months = within(group).getAllByRole("button", { expanded: false });
    expect(months.map((b) => b.textContent)).toEqual([
      expect.stringContaining("Setembro de 2026"),
      expect.stringContaining("Agosto de 2026"),
    ]);
    expect(cards()).toEqual(["aberto-1"]);

    fireEvent.click(screen.getByTestId("closed-month-won-2026-09"));
    expect(cards()).toEqual(["set-b", "set-a", "aberto-1"]);

    fireEvent.click(screen.getByTestId("closed-month-won-2026-08"));
    expect(cards()).toEqual(["set-b", "set-a", "ago-a", "aberto-1"]);

    fireEvent.click(within(group).getByRole("button", { name: /Agrupar/ }));
    expect(screen.queryByTestId("closed-group-won")).toBeNull();
    expect(cards()).toEqual(["aberto-1"]);

    // Reabrir começa do resumo: os meses voltam fechados.
    fireEvent.click(screen.getByTestId("closed-stack-won"));
    expect(cards()).toEqual(["aberto-1"]);
  });

  it("Abrir todos mostra a lista completa", () => {
    mount({ items: ITEMS });
    fireEvent.click(screen.getByTestId("closed-stack-won"));
    fireEvent.click(screen.getByRole("button", { name: /Abrir todos/ }));
    expect(cards()).toEqual(["set-b", "set-a", "ago-a", "aberto-1"]);
    expect(screen.queryByRole("button", { name: /Abrir todos/ })).toBeNull();
  });

  it("grupo de um mês só abre direto nos cards", () => {
    mount({ items: [{ id: "p", outcome: "lost", closedAt: local(2026, 9, 1) }] });
    fireEvent.click(screen.getByTestId("closed-stack-lost"));
    expect(cards()).toEqual(["p"]);
  });

  it("com encerrados escondidos, carregar mais vira botão (sem cascata de páginas)", () => {
    const onLoadMore = vi.fn();
    mount({ items: ITEMS, hasMore: true, onLoadMore, totalCount: 40 });
    expect(screen.getByTestId("closed-stack-won")).toHaveTextContent("3+");
    expect(onLoadMore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Carregar mais/ }));
    expect(onLoadMore).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /Carregar mais/ })).toHaveTextContent("35 na etapa");
  });

  it("sem acessores o board continua lista plana", () => {
    render(
      <DraggableKanbanBoard<Card>
        columns={[{ id: "x", title: "X", color: "red", items: ITEMS }]}
        onStatusChange={vi.fn()}
        renderCard={(card) => <div data-testid="card">{card.id}</div>}
      />,
    );
    expect(cards()).toHaveLength(ITEMS.length);
    expect(screen.queryByTestId("closed-stack-won")).toBeNull();
  });
});
