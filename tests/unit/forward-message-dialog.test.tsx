import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForwardMessageDialog } from "../../src/modules/communication/components/chat/actions/ForwardMessageDialog";
import { forwardMessage } from "../../src/modules/communication/lib/whatsappApi";

vi.mock("../../src/modules/communication/lib/whatsappApi", () => ({ forwardMessage: vi.fn() }));
vi.mock(
  "../../src/modules/communication/hooks/chat/useWhatsAppContacts",
  () => ({
    useWhatsAppContacts: () => ({
      data: [
        {
          channel: "whatsapp",
          phone_number: "5511000000000",
          saved_contact_name: "Cliente A",
          is_group: false,
        },
        { channel: "whatsapp", phone_number: "12000000000", push_name: "Equipe", is_group: true },
      ],
      isLoading: false,
      isError: false,
    }),
  }),
);
const close = vi.fn();
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <ForwardMessageDialog
        instanceId="instance"
        rowId="row"
        preview="Texto original"
        onClose={close}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
describe("forward confirmation", () => {
  it("requires a destination and explicit confirmation, filters by saved name", async () => {
    vi.mocked(forwardMessage).mockResolvedValue({ message_id: "sent", status: "sent" });
    mount();
    expect((screen.getByRole("button", { name: "Encaminhar" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Cliente A" } });
    expect(screen.queryByText("Equipe")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Cliente A/ }));
    expect(forwardMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar" }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(forwardMessage).toHaveBeenCalledExactlyOnceWith("instance", "row", "5511000000000");
  });
  it("cancel never sends", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(close).toHaveBeenCalledOnce();
    expect(forwardMessage).not.toHaveBeenCalled();
  });
  it("does not retry or close on a failed forwarding", async () => {
    vi.mocked(forwardMessage).mockRejectedValue(new Error("Sem acesso"));
    mount();
    fireEvent.click(screen.getByRole("radio", { name: /Equipe/ }));
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar" }));
    expect(await screen.findByText("Sem acesso")).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
    expect(forwardMessage).toHaveBeenCalledTimes(1);
  });
  it("locks submission and close while sending", async () => {
    vi.mocked(forwardMessage).mockImplementation(() => new Promise(() => {}));
    mount();
    fireEvent.click(screen.getByRole("radio", { name: /Equipe/ }));
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar" }));
    fireEvent.click(screen.getByRole("button", { name: /Encaminha/ }));
    await waitFor(() => expect(forwardMessage).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(close).not.toHaveBeenCalled();
  });
});
