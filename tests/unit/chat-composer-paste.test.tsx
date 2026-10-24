/**
 * ChatComposer — colar imagem (Ctrl/⌘+V) e gate de envio no paste/drop.
 *
 * Contrato: imagem colada no campo abre o MESMO preview do botão de anexo;
 * texto colado segue nativo; com envio em andamento nem paste nem drop trocam
 * o anexo (o clearAttachment pós-envio apagaria o arquivo novo).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, createEvent } from "@testing-library/react";

const sendState = { pending: false, mediaPending: false };

vi.mock("@/modules/communication/hooks/chat/useWhatsAppSend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/communication/hooks/chat/useWhatsAppSend")>()),
  useSendWhatsAppMessage: () => ({ mutateAsync: vi.fn(), isPending: sendState.pending }),
  useSendWhatsAppMedia: () => ({ mutateAsync: vi.fn(), isPending: sendState.mediaPending }),
}));
vi.mock("@/modules/communication/hooks/useConversationDraft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/communication/hooks/useConversationDraft")>()),
  useConversationDraft: () => {
    const [draft, setDraft] = useState("");
    return { draft, setDraft };
  },
}));
vi.mock("@/modules/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/identity")>()),
  useAuth: () => ({ user: { id: "user-1" } }),
  useCurrentTeamMember: () => ({ data: { organization_id: "org-1", name: "Vendedor" } }),
}));
vi.mock("@/modules/communication/hooks/chat/useTypingPresence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/communication/hooks/chat/useTypingPresence")>()),
  useTypingPresence: () => ({ typing: vi.fn(), stop: vi.fn() }),
}));
vi.mock("@/modules/communication/hooks/useMessageTemplates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/communication/hooks/useMessageTemplates")>()),
  useMessageTemplates: () => ({ data: [] }),
}));
vi.mock("@/modules/communication/hooks/useInstanceCapabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/communication/hooks/useInstanceCapabilities")>()),
  useInstanceCapabilities: () => ({ canUseUazapiActions: false }),
}));
vi.mock("@/modules/communication/hooks/chat/useChatReply", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/communication/hooks/chat/useChatReply")>()),
  useChatReply: () => null,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("sonner", async (importOriginal) => {
  const real = await importOriginal<typeof import("sonner")>();
  return {
    ...real,
    toast: Object.assign(vi.fn(), {
      ...real.toast,
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    }),
  };
});

import { toast } from "sonner";
import { ChatComposer } from "@/modules/communication/components/chat/composer/ChatComposer";

const PROPS = {
  conversationKey: "inst-1:5511999990000",
  phoneNumber: "5511999990000",
  contactName: "Maria",
  instanceName: "inst1",
  instanceId: "inst-1",
  canReply: true,
};

const box = () => screen.getByLabelText("Digite uma mensagem para Maria") as HTMLTextAreaElement;
const PREVIEW_ALT = "Preview da imagem a ser enviada";

function clipboard({ images = [] as File[], text = "" } = {}) {
  return {
    items: images.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
    files: images,
    getData: (fmt: string) => (fmt === "text/plain" ? text : ""),
  };
}

function paste(el: HTMLElement, data: ReturnType<typeof clipboard>) {
  const event = createEvent.paste(el, { clipboardData: data });
  fireEvent(el, event);
  return event;
}

const png = () => new File(["fake-png"], "image.png", { type: "image/png" });

describe("ChatComposer — colar imagem", () => {
  beforeEach(() => {
    sendState.pending = false;
    sendState.mediaPending = false;
    vi.mocked(toast.info).mockClear();
    vi.mocked(toast.error).mockClear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
  });

  it("imagem colada abre o mesmo preview do botão de anexo", async () => {
    render(<ChatComposer {...PROPS} />);
    const ev = paste(box(), clipboard({ images: [png()] }));
    expect(ev.defaultPrevented).toBe(true);
    expect(await screen.findByAltText(PREVIEW_ALT)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Adicionar legenda (opcional)...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar Imagem/ })).toBeInTheDocument();
  });

  it("formato que o validador recusa (tiff) dá toast e não abre preview", () => {
    render(<ChatComposer {...PROPS} />);
    paste(box(), clipboard({ images: [new File(["x"], "scan.tiff", { type: "image/tiff" })] }));
    expect(toast.error).toHaveBeenCalled();
    expect(screen.queryByAltText(PREVIEW_ALT)).not.toBeInTheDocument();
  });

  it("texto colado segue nativo (sem preventDefault, sem preview)", () => {
    render(<ChatComposer {...PROPS} />);
    const ev = paste(box(), clipboard({ text: "segue o orçamento" }));
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.queryByAltText(PREVIEW_ALT)).not.toBeInTheDocument();
  });

  it("com envio em andamento, colar imagem não troca o anexo", () => {
    sendState.mediaPending = true;
    render(<ChatComposer {...PROPS} />);
    const ev = paste(box(), clipboard({ images: [png()] }));
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.queryByAltText(PREVIEW_ALT)).not.toBeInTheDocument();
  });

  it("com envio em andamento, soltar arquivo avisa e não troca o anexo", () => {
    sendState.pending = true;
    const { container } = render(<ChatComposer {...PROPS} />);
    const zone = container.firstElementChild as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [png()] } });
    expect(toast.info).toHaveBeenCalledWith("Aguarde o envio anterior finalizar.");
    expect(screen.queryByAltText(PREVIEW_ALT)).not.toBeInTheDocument();
  });
});
