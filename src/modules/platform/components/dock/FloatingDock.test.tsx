import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DockItem, DockOrder, FloatingDock, FloatingDockProvider } from "./FloatingDock";

/**
 * O dock existe para resolver um bug que já estava em produção: `ChatBubbleFab`,
 * `OraculoFloatingButton` e o painel de progresso do disparo renderizavam todos
 * em `fixed bottom-6 right-6`, empilhando-se e ocultando uns aos outros.
 */
describe("FloatingDock", () => {
  it("renderiza os itens que se registraram", () => {
    render(
      <FloatingDockProvider>
        <DockItem order={DockOrder.chat}>
          <button>chat</button>
        </DockItem>
        <FloatingDock />
      </FloatingDockProvider>,
    );

    expect(screen.getByRole("button", { name: "chat" })).toBeInTheDocument();
  });

  it("não renderiza nada quando ninguém se registrou", () => {
    const { container } = render(
      <FloatingDockProvider>
        <FloatingDock />
      </FloatingDockProvider>,
    );

    expect(container.querySelector("[data-dock-item]")).toBeNull();
  });

  // O item mais usado fica mais perto do polegar. A ordem visual vem do `order`
  // do flexbox, não da ordem em que os componentes montaram — o Oráculo só
  // existe no Dashboard, e o dock não pode depender de quem montou primeiro.
  it("ordena pelo `order`, não pela ordem de montagem", () => {
    render(
      <FloatingDockProvider>
        <DockItem order={DockOrder.support}>
          <button>suporte</button>
        </DockItem>
        <DockItem order={DockOrder.chat}>
          <button>chat</button>
        </DockItem>
        <FloatingDock />
      </FloatingDockProvider>,
    );

    const suporte = screen.getByRole("button", { name: "suporte" }).closest("[data-dock-item]");
    const chat = screen.getByRole("button", { name: "chat" }).closest("[data-dock-item]");

    expect(suporte).toHaveStyle({ order: String(DockOrder.support) });
    expect(chat).toHaveStyle({ order: String(DockOrder.chat) });
    expect(DockOrder.chat).toBeLessThan(DockOrder.support);
  });

  it("um item registrado depois do dock também aparece", () => {
    const { rerender } = render(
      <FloatingDockProvider>
        <FloatingDock />
      </FloatingDockProvider>,
    );

    rerender(
      <FloatingDockProvider>
        <FloatingDock />
        <DockItem order={DockOrder.oraculo}>
          <button>oráculo</button>
        </DockItem>
      </FloatingDockProvider>,
    );

    expect(screen.getByRole("button", { name: "oráculo" })).toBeInTheDocument();
  });

  // Um DockItem fora do provider seria um botão invisível — pior que um erro.
  it("um item fora do provider falha alto", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() =>
      render(
        <DockItem order={DockOrder.chat}>
          <button>orfão</button>
        </DockItem>,
      ),
    ).toThrow(/FloatingDockProvider/);
    spy.mockRestore();
  });

  it("a ordem canônica coloca o chat mais perto do canto", () => {
    expect(DockOrder.chat).toBeLessThan(DockOrder.oraculo);
    expect(DockOrder.oraculo).toBeLessThan(DockOrder.support);
  });
});
