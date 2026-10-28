/**
 * Campo de busca global da `AgendaFilterBar`: controlado, com limpar e Esc,
 * e ausente quando a tela não passa `onSearchChange`.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgendaFilterBar, ALL_OPTION } from "./AgendaFilterBar";
import { EVENT_TYPE_KEYS } from "./agenda-helpers";

function montar(props: Partial<React.ComponentProps<typeof AgendaFilterBar>> = {}) {
  return render(
    <AgendaFilterBar
      status="all"
      onStatusChange={vi.fn()}
      owner={ALL_OPTION}
      onOwnerChange={vi.fn()}
      ownerOptions={[]}
      activeTypes={new Set(EVENT_TYPE_KEYS)}
      onToggleType={vi.fn()}
      {...props}
    />,
  );
}

describe("AgendaFilterBar — busca", () => {
  it("não desenha o campo sem onSearchChange", () => {
    montar();
    expect(screen.queryByRole("searchbox", { name: "Buscar na agenda" })).toBeNull();
  });

  it("desenha o campo controlado e propaga cada digitação", async () => {
    const onSearchChange = vi.fn();
    montar({ search: "", onSearchChange });
    const campo = screen.getByRole("searchbox", { name: "Buscar na agenda" });
    expect(campo).toHaveValue("");
    await userEvent.type(campo, "ab");
    expect(onSearchChange).toHaveBeenNthCalledWith(1, "a");
    // Controlado: o valor só muda quando o pai devolve `search`.
    expect(onSearchChange).toHaveBeenNthCalledWith(2, "b");
  });

  it("mostra o termo recebido e o botão de limpar só quando há texto", () => {
    const { rerender } = montar({ search: "", onSearchChange: vi.fn() });
    expect(screen.queryByRole("button", { name: "Limpar busca" })).toBeNull();

    rerender(
      <AgendaFilterBar
        status="all"
        onStatusChange={vi.fn()}
        owner={ALL_OPTION}
        onOwnerChange={vi.fn()}
        ownerOptions={[]}
        activeTypes={new Set(EVENT_TYPE_KEYS)}
        onToggleType={vi.fn()}
        search="estrela"
        onSearchChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("searchbox", { name: "Buscar na agenda" })).toHaveValue("estrela");
    expect(screen.getByRole("button", { name: "Limpar busca" })).toBeInTheDocument();
  });

  it("limpar zera o termo", async () => {
    const onSearchChange = vi.fn();
    montar({ search: "estrela", onSearchChange });
    await userEvent.click(screen.getByRole("button", { name: "Limpar busca" }));
    expect(onSearchChange).toHaveBeenCalledWith("");
  });

  it("Esc limpa o termo; Esc com campo vazio não faz nada", () => {
    const onSearchChange = vi.fn();
    const { unmount } = montar({ search: "estrela", onSearchChange });
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Buscar na agenda" }), {
      key: "Escape",
    });
    expect(onSearchChange).toHaveBeenCalledWith("");
    unmount();

    const outro = vi.fn();
    montar({ search: "", onSearchChange: outro });
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Buscar na agenda" }), {
      key: "Escape",
    });
    expect(outro).not.toHaveBeenCalled();
  });
});
