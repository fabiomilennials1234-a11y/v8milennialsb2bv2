/**
 * Seletor de destinos do Encaminhar: busca, teto de 5 e relato por destino.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mutateAsync = vi.fn();
vi.mock("@/modules/communication/hooks/useMessageActions", () => ({
  useForwardMessage: () => ({ mutateAsync, isPending: false }),
}));

const contacts = Array.from({ length: 7 }, (_, i) => ({
  channel: "whatsapp",
  instance_id: "i1",
  phone_number: `551191000000${i}`,
  push_name: `Pessoa ${i}`,
  saved_contact_name: null,
  lead_name: null,
  is_group: false,
}));
vi.mock("@/modules/communication/hooks/chat/useWhatsAppContacts", () => ({
  useWhatsAppContacts: () => ({ data: contacts, isLoading: false }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { ForwardMessageDialog } from "./ForwardMessageDialog";

const props = {
  open: true,
  onOpenChange: vi.fn(),
  instanceId: "i1",
  sourceMessageId: "7b8f1d62-5c0a-4a5e-9d3c-2f1e8a9b0c11",
  preview: "Oi, tudo bem?",
};

beforeEach(() => {
  mutateAsync.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  props.onOpenChange.mockReset();
});

describe("ForwardMessageDialog", () => {
  it("mostra a prévia e começa sem destino: botão desligado", () => {
    render(<ForwardMessageDialog {...props} />);
    expect(screen.getByText("Oi, tudo bem?")).toBeTruthy();
    expect((screen.getByRole("button", { name: /^encaminhar/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("busca filtra por nome e telefone", () => {
    render(<ForwardMessageDialog {...props} />);
    fireEvent.change(screen.getByPlaceholderText(/buscar/i), { target: { value: "Pessoa 3" } });
    expect(screen.getByText("Pessoa 3")).toBeTruthy();
    expect(screen.queryByText("Pessoa 0")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/buscar/i), { target: { value: "5511910000005" } });
    expect(screen.getByText("Pessoa 5")).toBeTruthy();
  });

  it("teto de 5: a sexta caixa fica desligada", () => {
    render(<ForwardMessageDialog {...props} />);
    const boxes = screen.getAllByRole("checkbox");
    for (let i = 0; i < 5; i++) fireEvent.click(boxes[i]);
    expect(boxes[5].hasAttribute("disabled") || boxes[5].getAttribute("data-disabled") !== null).toBe(true);
    expect(screen.getByRole("button", { name: /encaminhar para 5 conversas/i })).toBeTruthy();
  });

  it("envia o id da mensagem e os telefones escolhidos; sucesso fecha e avisa", async () => {
    mutateAsync.mockResolvedValue({
      results: [
        { number: "5511910000000", ok: true },
        { number: "5511910000001", ok: true },
      ],
    });
    render(<ForwardMessageDialog {...props} />);
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByRole("button", { name: /encaminhar para 2 conversas/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        instanceId: "i1",
        sourceMessageId: props.sourceMessageId,
        targets: ["5511910000000", "5511910000001"],
      }),
    );
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalled();
  });

  it("falha parcial: mantém aberto e avisa", async () => {
    mutateAsync.mockResolvedValue({
      results: [
        { number: "5511910000000", ok: true },
        { number: "5511910000001", ok: false, error: "send_failed" },
      ],
    });
    render(<ForwardMessageDialog {...props} />);
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByRole("button", { name: /encaminhar para 2 conversas/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("erro do pedido inteiro: toast de erro e mantém aberto", async () => {
    mutateAsync.mockRejectedValue(new Error("source_not_found"));
    render(<ForwardMessageDialog {...props} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: /encaminhar para 1 conversa/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
