/**
 * ChatBubbleComposer — fluxo de anexo (paridade doc/vídeo com o composer desktop).
 *
 * Cobre a correção "bubble só aceitava imagem":
 *  1. accept do file input inclui PDF/documentos
 *  2. PDF anexado → chip com nome do arquivo (sem thumbnail)
 *  3. Enviar PDF → sendMedia com mediaType document + fileName + mimetype
 *  4. Imagem anexada → thumbnail (comportamento pré-existente preservado)
 *  5. Arquivo >16MB → toast destrutivo, sem preview, sem envio
 *  6. Cancelar limpa o anexo pendente
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSendMutateAsync = vi.fn().mockResolvedValue({});
const mockMediaMutateAsync = vi.fn().mockResolvedValue({});

vi.mock("@/modules/communication/hooks/chat/useWhatsAppSend", () => ({
  useSendWhatsAppMessage: () => ({
    mutateAsync: mockSendMutateAsync,
    isPending: false,
  }),
  useSendWhatsAppMedia: () => ({
    mutateAsync: mockMediaMutateAsync,
    isPending: false,
  }),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/modules/communication/components/chat/media/AudioRecorder", () => ({
  AudioRecorder: () => <div data-testid="audio-recorder" />,
}));

import { ChatBubbleComposer } from "@/modules/communication/components/chat/bubble/ChatBubbleComposer";
import { ATTACHMENT_ACCEPT } from "@/modules/communication/lib/attachment-media-type";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_PROPS = {
  phoneNumber: "5511999990000",
  instanceId: "inst-uuid-1",
  instanceName: "inst1",
  canReply: true,
  leadId: "lead-1",
};

function getFileInput(): HTMLInputElement {
  return screen.getByTestId("bubble-file-input") as HTMLInputElement;
}

function attachFile(file: File) {
  fireEvent.change(getFileInput(), { target: { files: [file] } });
}

const PDF_FILE = new File(["%PDF-1.7 fake"], "proposta.pdf", { type: "application/pdf" });
const IMG_FILE = new File(["fake-png"], "foto.png", { type: "image/png" });

function makeOversizedFile(): File {
  const f = new File(["x"], "gigante.pdf", { type: "application/pdf" });
  Object.defineProperty(f, "size", { value: 16 * 1024 * 1024 + 1 });
  return f;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ChatBubbleComposer — anexos", () => {
  beforeEach(() => {
    mockSendMutateAsync.mockClear();
    mockMediaMutateAsync.mockClear();
    mockToast.mockClear();
  });

  it("file input aceita PDF e documentos (accept compartilhado)", () => {
    render(<ChatBubbleComposer {...BASE_PROPS} />);
    expect(getFileInput().getAttribute("accept")).toBe(ATTACHMENT_ACCEPT);
    expect(getFileInput().getAttribute("accept")).toContain("application/pdf");
  });

  it("botão de anexar anuncia arquivo genérico, não só imagem", () => {
    render(<ChatBubbleComposer {...BASE_PROPS} />);
    expect(screen.getByLabelText("Anexar arquivo")).toBeInTheDocument();
  });

  it("PDF anexado mostra chip com nome do arquivo, sem <img>", async () => {
    render(<ChatBubbleComposer {...BASE_PROPS} />);
    attachFile(PDF_FILE);
    await waitFor(() => {
      expect(screen.getByText("proposta.pdf")).toBeInTheDocument();
    });
    expect(document.querySelector("img")).toBeNull();
  });

  it("enviar PDF chama sendMedia com mediaType document + fileName + mimetype", async () => {
    render(<ChatBubbleComposer {...BASE_PROPS} />);
    attachFile(PDF_FILE);
    await waitFor(() => screen.getByText("proposta.pdf"));

    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => {
      expect(mockMediaMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumber: "5511999990000",
          instanceId: "inst-uuid-1",
          mediaType: "document",
          fileName: "proposta.pdf",
          mimetype: "application/pdf",
          leadId: "lead-1",
        }),
      );
    });
    const media = mockMediaMutateAsync.mock.calls[0][0].media as string;
    expect(media.startsWith("data:application/pdf")).toBe(true);
  });

  it("legenda digitada no preview vira caption do documento", async () => {
    render(<ChatBubbleComposer {...BASE_PROPS} />);
    attachFile(PDF_FILE);
    await waitFor(() => screen.getByText("proposta.pdf"));

    fireEvent.change(screen.getByLabelText("Legenda do anexo"), {
      target: { value: "Segue a proposta" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => {
      expect(mockMediaMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ caption: "Segue a proposta" }),
      );
    });
  });

  it("imagem anexada preserva thumbnail (comportamento pré-existente)", async () => {
    render(<ChatBubbleComposer {...BASE_PROPS} />);
    attachFile(IMG_FILE);
    await waitFor(() => {
      expect(document.querySelector("img")).not.toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => {
      expect(mockMediaMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ mediaType: "image", fileName: "foto.png" }),
      );
    });
  });

  it("arquivo acima de 16MB é rejeitado com toast, sem preview nem envio", async () => {
    render(<ChatBubbleComposer {...BASE_PROPS} />);
    attachFile(makeOversizedFile());

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Anexo inválido",
          description: "Arquivo muito grande (máximo 16MB)",
          variant: "destructive",
        }),
      );
    });
    expect(screen.queryByText("gigante.pdf")).not.toBeInTheDocument();
    expect(mockMediaMutateAsync).not.toHaveBeenCalled();
  });

  it("arquivo de 0 bytes é rejeitado antes do preview", async () => {
    render(<ChatBubbleComposer {...BASE_PROPS} />);
    attachFile(new File([], "vazio.pdf", { type: "application/pdf" }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Anexo inválido",
          description: "Arquivo vazio — selecione outro arquivo.",
          variant: "destructive",
        }),
      );
    });
    expect(mockMediaMutateAsync).not.toHaveBeenCalled();
  });

  it("envio falho mantém anexo e legenda pra retry (não descarta antes do await)", async () => {
    mockMediaMutateAsync.mockRejectedValueOnce(new Error("sessão morta"));
    render(<ChatBubbleComposer {...BASE_PROPS} />);
    attachFile(PDF_FILE);
    await waitFor(() => screen.getByText("proposta.pdf"));

    fireEvent.change(screen.getByLabelText("Legenda do anexo"), {
      target: { value: "Segue a proposta" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(mockMediaMutateAsync).toHaveBeenCalled());
    // Preview + legenda intactos após falha
    expect(screen.getByText("proposta.pdf")).toBeInTheDocument();
    expect(screen.getByLabelText("Legenda do anexo")).toHaveValue("Segue a proposta");
  });

  it("envio com sucesso limpa o anexo e dá toast de confirmação", async () => {
    render(<ChatBubbleComposer {...BASE_PROPS} />);
    attachFile(PDF_FILE);
    await waitFor(() => screen.getByText("proposta.pdf"));

    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => {
      expect(screen.queryByText("proposta.pdf")).not.toBeInTheDocument();
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Arquivo enviado!" }),
    );
  });

  it("cancelar limpa o anexo pendente e volta ao composer padrão", async () => {
    render(<ChatBubbleComposer {...BASE_PROPS} />);
    attachFile(PDF_FILE);
    await waitFor(() => screen.getByText("proposta.pdf"));

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByText("proposta.pdf")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Anexar arquivo")).toBeInTheDocument();
    expect(mockMediaMutateAsync).not.toHaveBeenCalled();
  });
});
