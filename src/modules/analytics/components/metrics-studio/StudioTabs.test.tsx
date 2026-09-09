import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudioTabs } from "./StudioTabs";
const panels = ["Visão Geral", "Performance", "Saúde", "Mapa"].map((nome, ordem) => ({ id: String(ordem), nome, ordem, templateKey: null, layout: [] }));
const props = () => ({ paineis: panels, ativoId: "0", editavel: true, onSelecionar: vi.fn(), onCriar: vi.fn(), onRenomear: vi.fn(), onRemover: vi.fn(), onReordenar: vi.fn() });
describe("abas — teclado e controles de edição", () => {
  it("troca de painel com as setas do teclado", async () => {
    const handlers = props();
    render(<StudioTabs {...handlers} />);
    screen.getByRole("tab", { name: "Visão Geral" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(handlers.onSelecionar).toHaveBeenCalledWith("1");
  });
  it("não oferece ações de escrita no modo leitura", () => {
    render(<StudioTabs {...props()} editavel={false} />);
    expect(screen.queryByRole("button", { name: "Nova Aba" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Opções da aba/ })).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
  });
  it("admin cria uma aba sem entrar no modo de edição", async () => {
    const handlers = props();
    render(<StudioTabs {...handlers} editavel={false} podeCriar />);
    await userEvent.click(screen.getByRole("button", { name: "Nova Aba" }));
    expect(handlers.onCriar).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /Opções da aba/ })).toBeNull();
  });
  it("não duplica criação enquanto está salvando", () => {
    render(<StudioTabs {...props()} editavel={false} podeCriar busy />);
    expect(screen.getByRole("button", { name: "Nova Aba" })).toBeDisabled();
  });
  it("admin solicita exclusão da aba ativa sem entrar em edição", async () => {
    const handlers = props();
    render(<StudioTabs {...handlers} editavel={false} podeGerenciar />);
    await userEvent.click(screen.getByRole("button", { name: "Opções da aba Visão Geral" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Excluir aba" }));
    expect(handlers.onRemover).toHaveBeenCalledWith("0");
    expect(handlers.onSelecionar).not.toHaveBeenCalled();
  });
  it("reordena pela opção visível do menu", async () => {
    const handlers = props();
    render(<StudioTabs {...handlers} />);
    await userEvent.click(screen.getByRole("button", { name: "Opções da aba Visão Geral" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Mover para a direita" }));
    expect(handlers.onReordenar).toHaveBeenCalledWith(["1", "0", "2", "3"]);
  });
});
