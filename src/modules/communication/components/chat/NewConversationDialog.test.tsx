import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NewConversationDialog } from "./NewConversationDialog";

it("asks only for the phone and opens the composer without sending or creating a lead", () => {
  const onStart = vi.fn();
  const onOpenChange = vi.fn();
  render(<NewConversationDialog open onOpenChange={onOpenChange} onStart={onStart} instanceName="Vendas" />);
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Número de WhatsApp"), { target: { value: "(48) 99999-9999" } });
  fireEvent.click(screen.getByRole("button", { name: "Iniciar conversa" }));
  expect(onStart).toHaveBeenCalledWith("5548999999999");
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("keeps the dialog open for an invalid number", () => {
  const onStart = vi.fn();
  render(<NewConversationDialog open onOpenChange={vi.fn()} onStart={onStart} />);
  fireEvent.change(screen.getByLabelText("Número de WhatsApp"), { target: { value: "123" } });
  fireEvent.click(screen.getByRole("button", { name: "Iniciar conversa" }));
  expect(screen.getByRole("alert")).toHaveTextContent("válido com DDD");
  expect(onStart).not.toHaveBeenCalled();
});

it("requires choosing an inbox through the existing selector when ambiguous", () => {
  render(<NewConversationDialog open onOpenChange={vi.fn()} onStart={vi.fn()} unavailableReason="Selecione uma caixa de WhatsApp" />);
  expect(screen.getByRole("button", { name: "Iniciar conversa" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("Selecione uma caixa");
});
