/**
 * Encaminhar — o seletor de destino.
 *
 * Regras: destino é conversa 1:1 existente (grupo, arquivada e a própria
 * conversa de origem ficam de fora); a mensagem sai pelo número escolhido; um
 * destino por vez.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ForwardMessageDialog } from "./ForwardMessageDialog";

const { mutateAsync, contactsByInstance } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  contactsByInstance: {} as Record<string, unknown[]>,
}));

vi.mock("@/modules/communication/hooks/chat/useWhatsAppInstances", () => ({
  useWhatsAppInstancesForUser: () => ({
    data: [
      { id: "chip-a", instance_name: "Vendas", status: "connected", provider: "uazapi" },
      { id: "chip-meta", instance_name: "Oficial", status: "connected", provider: "meta_cloud" },
    ],
  }),
}));
vi.mock("@/modules/communication/hooks/chat/useWhatsAppContacts", () => ({
  useWhatsAppContacts: (instanceId: string | null) => ({
    data: instanceId ? contactsByInstance[instanceId] ?? [] : [],
    isLoading: false,
  }),
}));
vi.mock("@/modules/communication/hooks/useMessageActions", () => ({
  useForwardMessage: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/shared/errors", () => ({ notifyError: vi.fn() }));

beforeAll(() => {
  // cmdk usa ResizeObserver e scrollIntoView; jsdom não tem.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

function contact(over: Record<string, unknown>) {
  return {
    channel: "whatsapp",
    instance_id: "chip-a",
    phone_number: "5548999990001",
    push_name: null,
    saved_contact_name: null,
    lead_name: null,
    lead_id: null,
    is_group: false,
    archived_at: null,
    last_message: null,
    last_message_time: "2026-10-08T12:00:00Z",
    last_message_direction: null,
    last_message_sent_source: null,
    unread_count: 0,
    conversation_id: null,
    tags: [],
    ...over,
  };
}

function open() {
  return render(
    <ForwardMessageDialog
      open
      onOpenChange={() => {}}
      sourceInstanceId="chip-a"
      sourceMessageId="PROV-ORIGEM"
      sourceNumber="5548999990000"
    />,
  );
}

describe("ForwardMessageDialog", () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue({ message_id: "PROV-NOVO" });
    contactsByInstance["chip-a"] = [
      contact({ phone_number: "5548999990000", push_name: "Origem" }),
      contact({ phone_number: "5548999990001", push_name: "Bruna", lead_id: "lead-b" }),
      contact({ phone_number: "120363000000000000", push_name: "Grupo Pedidos", is_group: true }),
      contact({ phone_number: "5548999990002", push_name: "Arquivada", archived_at: "2026-10-01T00:00:00Z" }),
    ];
  });

  it("lista só conversas 1:1 ativas e esconde a de origem", () => {
    open();
    expect(screen.getByText("Bruna")).toBeInTheDocument();
    expect(screen.queryByText("Origem")).not.toBeInTheDocument();
    expect(screen.queryByText("Grupo Pedidos")).not.toBeInTheDocument();
    expect(screen.queryByText("Arquivada")).not.toBeInTheDocument();
  });

  it("número que não é Uazapi não aparece como opção de envio", () => {
    open();
    // Só uma caixa encaminhável: o seletor de número nem é desenhado.
    expect(screen.queryByLabelText("Número de envio")).not.toBeInTheDocument();
  });

  it("Encaminhar fica desabilitado até escolher o destino", () => {
    open();
    expect(screen.getByRole("button", { name: "Encaminhar" })).toBeDisabled();
  });

  it("encaminha pelo chip da conversa escolhida, com a origem identificada", async () => {
    open();
    fireEvent.click(screen.getByText("Bruna"));
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      destInstanceId: "chip-a",
      destNumber: "5548999990001",
      sourceInstanceId: "chip-a",
      sourceMessageId: "PROV-ORIGEM",
      destLeadId: "lead-b",
    });
  });
});
