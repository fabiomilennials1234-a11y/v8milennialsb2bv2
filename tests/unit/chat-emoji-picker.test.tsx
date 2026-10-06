import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import EmojiPickerPanel from "@/modules/communication/components/chat/actions/EmojiPickerPanel";
import { EmojiPickerPopover } from "@/modules/communication/components/chat/actions/EmojiPickerPopover";
import { ComposerEmojiPicker } from "@/modules/communication/components/chat/composer/ComposerEmojiPicker";

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("catálogo de emojis", () => {
  it("busca em português sem acentos e fora da categoria atual", () => {
    const onSelect = vi.fn();
    render(<EmojiPickerPanel onSelect={onSelect} />);
    fireEvent.change(screen.getByLabelText("Buscar emoji"), { target: { value: "coracao" } });
    expect(screen.getByRole("button", { name: "coração vermelho", exact: true })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar emoji"), { target: { value: "pizza" } });
    fireEvent.click(screen.getByRole("button", { name: "pizza", exact: true }));
    expect(onSelect).toHaveBeenCalledWith("🍕");
  });

  it("inclui emojis novos do Unicode 17 e bandeiras completas", () => {
    const onSelect = vi.fn();
    render(<EmojiPickerPanel onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "rosto distorcido", exact: true }));
    expect(onSelect).toHaveBeenLastCalledWith("🫪");
    fireEvent.click(screen.getByRole("button", { name: "Bandeiras", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "bandeira: Brasil", exact: true }));
    expect(onSelect).toHaveBeenLastCalledWith("🇧🇷");
  });

  it("seleciona tons de pele e permite encontrar combinações de tons", () => {
    const onSelect = vi.fn();
    render(<EmojiPickerPanel onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Pessoas e gestos" }));
    fireEvent.change(screen.getByLabelText("Tom de pele"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "polegar para cima: pele morena", exact: true }));
    expect(onSelect).toHaveBeenLastCalledWith("👍🏽");
    fireEvent.change(screen.getByLabelText("Buscar emoji"), { target: { value: "🫱🏿‍🫲🏻" } });
    fireEvent.click(screen.getByText("🫱🏿‍🫲🏻"));
    expect(onSelect).toHaveBeenLastCalledWith("🫱🏿‍🫲🏻");
  });

  it("preserva recentes entre aberturas sem duplicar e lida com busca vazia", () => {
    const { unmount } = render(<EmojiPickerPanel onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "rosto distorcido", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "rosto distorcido", exact: true }));
    unmount();
    render(<EmojiPickerPanel onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Recentes" }));
    expect(screen.getAllByRole("button", { name: "rosto distorcido", exact: true })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Buscar emoji"), { target: { value: "zzzzzzzz" } });
    expect(screen.getByRole("status")).toHaveTextContent("Nenhum emoji encontrado.");
  });

  it("continua selecionando quando o armazenamento está indisponível", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const onSelect = vi.fn();
    render(<EmojiPickerPanel onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "rosto distorcido", exact: true }));
    expect(onSelect).toHaveBeenCalledWith("🫪");
  });
});

describe("reações", () => {
  it("mantém as seis opções rápidas e abre o catálogo completo", async () => {
    const onSelect = vi.fn();
    render(<EmojiPickerPopover onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Reagir com emoji" }));
    expect(screen.getByRole("button", { name: "Reagir com 👍" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mais emojis" }));
    fireEvent.change(await screen.findByLabelText("Buscar emoji"), { target: { value: "pizza" } });
    fireEvent.click(screen.getByRole("button", { name: "pizza", exact: true }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("🍕");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("bloqueia seleção pendente e fecha quando fica desabilitado", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<EmojiPickerPopover onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Reagir com emoji" }));
    rerender(<EmojiPickerPopover onSelect={onSelect} disabled />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Reagir com emoji" })).toBeDisabled();
    expect(onSelect).not.toHaveBeenCalled();
    rerender(<EmojiPickerPopover onSelect={onSelect} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

function Composer({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState("Olá cliente!");
  const ref = useRef<HTMLTextAreaElement>(null);
  return <><textarea ref={ref} aria-label="Mensagem" value={value} onChange={(event) => setValue(event.target.value)} disabled={disabled} /><ComposerEmojiPicker inputRef={ref} onChange={setValue} disabled={disabled} /></>;
}

describe("inserção no campo de mensagem", () => {
  it("substitui seleção, restaura cursor e permite inserir outro emoji no mesmo ponto", async () => {
    render(<Composer />);
    const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Mensagem" });
    input.focus();
    input.setSelectionRange(4, 11);
    fireEvent.click(screen.getByRole("button", { name: "Inserir emoji" }));
    fireEvent.change(await screen.findByLabelText("Buscar emoji"), { target: { value: "pizza" } });
    fireEvent.click(screen.getByRole("button", { name: "pizza", exact: true }));
    await waitFor(() => { expect(input).toHaveFocus(); expect(input.selectionStart).toBe(6); });
    expect(input).toHaveValue("Olá 🍕!");
    fireEvent.click(screen.getByRole("button", { name: "Inserir emoji" }));
    fireEvent.click(await screen.findByRole("button", { name: "rosto distorcido", exact: true }));
    await waitFor(() => expect(input).toHaveValue("Olá 🍕🫪!"));
  });

  it("Escape fecha sem alterar o rascunho e o botão respeita o bloqueio", async () => {
    const { rerender } = render(<Composer />);
    fireEvent.click(screen.getByRole("button", { name: "Inserir emoji" }));
    fireEvent.keyDown(await screen.findByLabelText("Buscar emoji"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "Mensagem" })).toHaveValue("Olá cliente!");
    rerender(<Composer disabled />);
    expect(screen.getByRole("button", { name: "Inserir emoji" })).toBeDisabled();
  });
});
