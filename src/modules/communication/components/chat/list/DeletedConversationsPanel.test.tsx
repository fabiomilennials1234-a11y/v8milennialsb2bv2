/**
 * Regressão coberta aqui: conversa excluída no chat era invisível PARA SEMPRE.
 * `get_whatsapp_conversation_list` filtra `deleted_at IS NULL` e nada devolvia
 * o campo para NULL — sem desfazer na UI e sem sequer poder VER o que foi
 * excluído. Estes testes travam as três garantias da saída nova: o gatilho não
 * polui a barra quando não há nada, a contagem de mensagens aparece (é o que
 * diz "isso é conversa de cliente, não lixo") e restaurar chama a RPC com o id
 * certo.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeletedConversationsPanel } from "./DeletedConversationsPanel";

const restoreMutate = vi.fn();
let deletedRows: Array<{
  id: string;
  phone_number: string;
  deleted_at: string;
  message_count: number;
}> = [];

vi.mock("@/modules/communication/hooks/useWhatsAppConversations", () => ({
  useDeletedConversations: () => ({ data: deletedRows, isLoading: false }),
  useRestoreConversation: () => ({ mutateAsync: restoreMutate }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  // O ScrollArea do Radix instancia ResizeObserver no mount, e o jsdom não tem.
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  restoreMutate.mockReset();
  restoreMutate.mockResolvedValue("conv-1");
  deletedRows = [];
});

describe("DeletedConversationsPanel", () => {
  it("sem conversa excluída não renderiza nada — a barra do inbox não ganha ruído", () => {
    const { container } = render(<DeletedConversationsPanel instanceId="inst-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("mostra o gatilho com a contagem, no singular e no plural", () => {
    deletedRows = [
      { id: "c1", phone_number: "5548999999999", deleted_at: "2026-07-07T12:25:01Z", message_count: 529 },
    ];
    const { rerender, container } = render(<DeletedConversationsPanel instanceId="inst-1" />);
    expect(screen.getByRole("button", { name: /1 conversa excluída/i })).toBeInTheDocument();

    deletedRows = [
      ...deletedRows,
      { id: "c2", phone_number: "5548988888888", deleted_at: "2026-07-10T13:18:36Z", message_count: 0 },
    ];
    rerender(<DeletedConversationsPanel instanceId="inst-1" />);
    expect(screen.getByRole("button", { name: /2 conversas excluídas/i })).toBeInTheDocument();
    expect(container).not.toBeEmptyDOMElement();
  });

  it("abre a lista com telefone, data e o TAMANHO da conversa", async () => {
    deletedRows = [
      { id: "c1", phone_number: "5548999999999", deleted_at: "2026-07-07T12:25:01Z", message_count: 529 },
    ];
    const user = userEvent.setup();
    render(<DeletedConversationsPanel instanceId="inst-1" />);

    await user.click(screen.getByRole("button", { name: /1 conversa excluída/i }));

    expect(await screen.findByText("5548999999999")).toBeInTheDocument();
    // A contagem é o dado que evita restaurar às cegas.
    expect(screen.getByText(/529 mensagens/)).toBeInTheDocument();
    expect(screen.getByText(/Excluída em 07\/07\/2026/)).toBeInTheDocument();
  });

  it("conversa vazia não inventa '0 mensagens'", async () => {
    deletedRows = [
      { id: "c2", phone_number: "5548988888888", deleted_at: "2026-07-10T13:18:36Z", message_count: 0 },
    ];
    const user = userEvent.setup();
    render(<DeletedConversationsPanel instanceId="inst-1" />);
    await user.click(screen.getByRole("button", { name: /1 conversa excluída/i }));

    expect(await screen.findByText("5548988888888")).toBeInTheDocument();
    expect(screen.queryByText(/0 mensagens/)).not.toBeInTheDocument();
  });

  it("restaurar chama a RPC com o id daquela conversa", async () => {
    deletedRows = [
      { id: "c1", phone_number: "5548999999999", deleted_at: "2026-07-07T12:25:01Z", message_count: 529 },
      { id: "c2", phone_number: "5548988888888", deleted_at: "2026-07-10T13:18:36Z", message_count: 4 },
    ];
    const user = userEvent.setup();
    render(<DeletedConversationsPanel instanceId="inst-1" />);
    await user.click(screen.getByRole("button", { name: /2 conversas excluídas/i }));

    const botoes = await screen.findAllByRole("button", { name: /Restaurar/i });
    await user.click(botoes[1]);

    await waitFor(() => {
      expect(restoreMutate).toHaveBeenCalledWith({ conversationId: "c2" });
    });
    expect(restoreMutate).toHaveBeenCalledTimes(1);
  });

  it("falha da RPC não derruba a tela (não-admin recebe recusa do servidor)", async () => {
    restoreMutate.mockRejectedValue(new Error("Apenas administradores podem restaurar conversas"));
    deletedRows = [
      { id: "c1", phone_number: "5548999999999", deleted_at: "2026-07-07T12:25:01Z", message_count: 529 },
    ];
    const user = userEvent.setup();
    render(<DeletedConversationsPanel instanceId="inst-1" />);
    await user.click(screen.getByRole("button", { name: /1 conversa excluída/i }));
    await user.click(await screen.findByRole("button", { name: /Restaurar/i }));

    await waitFor(() => expect(restoreMutate).toHaveBeenCalled());
    // A linha continua lá — nada de tela branca.
    expect(screen.getByText("5548999999999")).toBeInTheDocument();
  });
});
