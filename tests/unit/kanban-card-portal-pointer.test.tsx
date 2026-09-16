import React from "react";
import { createPortal } from "react-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { activate } = vi.hoisted(() => ({ activate: vi.fn() }));
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({
    attributes: {}, listeners: { onPointerDown: activate },
    setNodeRef: vi.fn(), transform: null, transition: undefined, isDragging: false,
  }),
}));

import { DraggableKanbanBoard } from "@/modules/pipelines/components/kanban/DraggableKanbanBoard";

beforeEach(() => vi.clearAllMocks());

function mountBoard() {
  render(
    <DraggableKanbanBoard
      columns={[{ id: "stage-1", title: "Novo", color: "blue", items: [{ id: "entry-1" }] }]}
      onStatusChange={vi.fn()}
      renderCard={() => <>
        <div>Corpo do negócio</div>
        {createPortal(<button>Item do checklist</button>, document.body)}
      </>}
    />,
  );
}

describe("Arrasto do negócio com painel em portal", () => {
  it("continua ativando o sensor ao pressionar o próprio card", () => {
    mountBoard();
    fireEvent.pointerDown(screen.getByText("Corpo do negócio"));
    expect(activate).toHaveBeenCalledOnce();
  });

  it("ignora o painel e deixa o evento chegar ao documento para fechar por clique fora", () => {
    mountBoard();
    const documentPointer = vi.fn();
    document.addEventListener("pointerdown", documentPointer);
    try {
      fireEvent.pointerDown(screen.getByRole("button", { name: "Item do checklist" }));
      expect(activate).not.toHaveBeenCalled();
      expect(documentPointer).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener("pointerdown", documentPointer);
    }
  });
});
