import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AttachmentStrip } from "./AttachmentStrip";

const upload = vi.fn();
const attachments = { current: [] as { path: string; name: string; signedUrl: string }[] };

vi.mock("@/modules/platform/hooks/useTicketAttachments", () => ({
  useTicketAttachments: () => ({ data: attachments.current }),
  useUploadTicketAttachment: () => ({ mutateAsync: upload, isPending: false }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const png = () => new File(["x"], "print.png", { type: "image/png" });

beforeEach(() => {
  upload.mockReset().mockResolvedValue("t1/abc.png");
  attachments.current = [];
});

describe("AttachmentStrip", () => {
  it("não renderiza nada sem anexos e sem permissão de anexar", () => {
    const { container } = render(<AttachmentStrip ticketId="t1" canAttach={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("mostra os anexos existentes mesmo sem poder anexar", () => {
    attachments.current = [{ path: "t1/a.png", name: "a.png", signedUrl: "https://signed/a.png" }];
    render(<AttachmentStrip ticketId="t1" canAttach={false} />);

    expect(screen.getByAltText("Anexo do chamado")).toHaveAttribute("src", "https://signed/a.png");
    expect(screen.queryByRole("button", { name: /anexar/i })).not.toBeInTheDocument();
  });

  // A captura dos ids tecnicos e silenciosa: eles nao expoem nada. A do print e
  // explicita, porque ele expoe tudo.
  it("pede confirmação antes de enviar, e não envia sozinho", async () => {
    const user = userEvent.setup();
    const { container } = render(<AttachmentStrip ticketId="t1" canAttach />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, png());

    expect(await screen.findByText(/dados dos seus clientes/i)).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("recusar o aviso não envia nada", async () => {
    const user = userEvent.setup();
    const { container } = render(<AttachmentStrip ticketId="t1" canAttach />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, png());
    await user.click(await screen.findByRole("button", { name: "Não enviar" }));

    expect(upload).not.toHaveBeenCalled();
  });

  it("confirmar envia o arquivo", async () => {
    const user = userEvent.setup();
    const { container } = render(<AttachmentStrip ticketId="t1" canAttach />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, png());
    await user.click(await screen.findByRole("button", { name: "Enviar mesmo assim" }));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0][0].ticketId).toBe("t1");
    expect(upload.mock.calls[0][0].file.name).toBe("print.png");
  });

  // O aviso é a única barreira antes de uma imagem sair da máquina do cliente.
  it("o aviso diz que o suporte vai ver e que o link expira", async () => {
    const user = userEvent.setup();
    const { container } = render(<AttachmentStrip ticketId="t1" canAttach />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, png());

    const texto = (await screen.findByText(/dados dos seus clientes/i)).closest("div")!.textContent!;
    expect(texto).toMatch(/suporte da Torque vai ver/i);
    expect(texto).toMatch(/expira/i);
  });
});
