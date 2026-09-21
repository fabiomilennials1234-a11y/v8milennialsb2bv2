import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { WorkflowToolbar } from "../WorkflowToolbar";

describe("Pergunta com botões — disponibilidade", () => {
  it("oculta por padrão e permite adicionar quando organização está liberada", () => {
    const onAddNode = vi.fn();
    const props = { name: "Fluxo", onNameChange: vi.fn(), isActive: false, onToggleActive: vi.fn(), onSave: vi.fn(), isSaving: false, onAddNode, isNew: true };
    render(<MemoryRouter><WorkflowToolbar {...props} /></MemoryRouter>);
    fireEvent.keyDown(screen.getByRole("button", { name: /adicionar nó/i }), { key: "Enter" });
    expect(screen.queryByRole("menuitem", { name: "Pergunta com botões" })).not.toBeInTheDocument();
    cleanup();
    render(<MemoryRouter><WorkflowToolbar {...props} questionButtonsEnabled /></MemoryRouter>);
    fireEvent.keyDown(screen.getByRole("button", { name: /adicionar nó/i }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Pergunta com botões" }));
    expect(onAddNode).toHaveBeenCalledWith("question_buttons");
  });
});
