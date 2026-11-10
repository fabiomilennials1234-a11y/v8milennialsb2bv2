/**
 * Teclado no card do board (piloto do "Ir para o negócio", `tecladoAbreCard`).
 *
 * Com a flag, Enter/Espaço no card focado abrem o negócio, o contorno de foco é
 * legível nos dois temas e o leitor de tela ouve instruções em português. Sem a
 * flag, o board fica EXATAMENTE como era — o piloto não muda nada para as
 * outras orgs.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sortable = vi.hoisted(() => ({ isDragging: false }));
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({
    attributes: { role: "button", tabIndex: 0 },
    listeners: { onPointerDown: vi.fn() },
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: sortable.isDragging,
  }),
}));

import { DraggableKanbanBoard } from "@/modules/pipelines/components/kanban/DraggableKanbanBoard";

const abrir = vi.fn();

function montar(props: { tecladoAbreCard?: boolean; disabled?: boolean } = {}) {
  render(
    <DraggableKanbanBoard
      columns={[{ id: "stage-1", title: "Novo", color: "blue", items: [{ id: "entry-1" }] }]}
      onStatusChange={vi.fn()}
      renderCard={() => (
        <div data-lead-id="entry-1" onClick={abrir}>
          Bar do Zé
          <button type="button">menu</button>
        </div>
      )}
      {...props}
    />,
  );
  return screen.getByText("Bar do Zé").closest<HTMLElement>('[role="button"]')!;
}

beforeEach(() => {
  abrir.mockReset();
  sortable.isDragging = false;
});

describe("teclado no card do board", () => {
  it("sem o piloto: o board fica como era — Enter não abre e não há contorno novo", () => {
    const card = montar();
    fireEvent.keyDown(card, { key: "Enter" });
    expect(abrir).not.toHaveBeenCalled();
    expect(card.className).not.toContain("outline-foreground");
    expect(screen.queryByText(/Enter abre o negócio/)).toBeNull();
  });

  it("com o piloto: Enter e Espaço abrem o negócio, com contorno legível nos dois temas", () => {
    const card = montar({ tecladoAbreCard: true });
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(abrir).toHaveBeenCalledTimes(2);
    expect(card.className).toContain("focus-visible:outline-foreground");
    expect(card.className).toContain("dark:focus-visible:outline-ring");
  });

  it("no meio de um arrasto, Enter e Espaço não abrem nada", () => {
    sortable.isDragging = true;
    const card = montar({ tecladoAbreCard: true });
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(abrir).not.toHaveBeenCalled();
  });

  it("tecla num controle de dentro do card (menu) não abre o card", () => {
    montar({ tecladoAbreCard: true });
    fireEvent.keyDown(screen.getByRole("button", { name: "menu" }), { key: "Enter" });
    expect(abrir).not.toHaveBeenCalled();
  });

  it("leitor de tela: instruções em português; sem permissão de mover, só a parte que vale", () => {
    montar({ tecladoAbreCard: true });
    expect(screen.getByText(/Para mudar de etapa, arraste com o mouse/)).toBeTruthy();
  });

  it("sem permissão de mover, a instrução não promete arrasto", () => {
    montar({ tecladoAbreCard: true, disabled: true });
    expect(screen.getByText("Enter abre o negócio.")).toBeTruthy();
    expect(screen.queryByText(/arraste/)).toBeNull();
  });
});
