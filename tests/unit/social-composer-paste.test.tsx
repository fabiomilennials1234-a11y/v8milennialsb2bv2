/**
 * SocialComposer (dentro de SocialChatView) — colar imagem no campo.
 *
 * Contrato: Ctrl/⌘+V com imagem publica o arquivo pelo MESMO caminho do clipe
 * (`uploadSocialAttachment`, que classifica e sobe); texto colado segue nativo;
 * com envio em andamento a colagem não troca o anexo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, createEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const uploadMock = vi.fn();

vi.mock("@/modules/communication/lib/social-attachment-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/communication/lib/social-attachment-upload")>()),
  uploadSocialAttachment: (...args: unknown[]) => uploadMock(...args),
}));
vi.mock("@/modules/communication/hooks/chat/useSocialMessages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/communication/hooks/chat/useSocialMessages")>()),
  useSocialMessages: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/modules/communication/components/chat/view/MessageList", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/communication/components/chat/view/MessageList")>()),
  MessageList: () => null,
}));
vi.mock("@/modules/communication/components/chat/media/ImagePreviewModal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/communication/components/chat/media/ImagePreviewModal")>()),
  ImagePreviewModal: () => null,
}));
vi.mock("@/modules/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/identity")>()),
  useCurrentTeamMember: () => ({ data: { id: "tm-1", organization_id: "org-1" } }),
}));

import { SocialChatView } from "@/modules/communication/components/chat/social/SocialChatView";
import type { SocialContact } from "@/modules/communication/hooks/chat/types";

const CONTACT: SocialContact = {
  channel: "instagram",
  conversation_key: "instagram:chan-1:igsid-1",
  messaging_channel_id: "chan-1",
  external_user_id: "igsid-1",
  handle: "cliente",
  display_name: "Cliente",
  avatar_url: null,
  last_message: null,
  last_message_time: new Date().toISOString(),
  last_message_direction: "incoming",
  unread_count: 0,
  lead_id: null,
  lead_name: null,
  tags: [],
};

function renderView(isPending = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SocialChatView
        selectedContact={CONTACT}
        boxChannel="instagram"
        sender={{ isPending, send: vi.fn().mockResolvedValue({}) }}
        channelName="Conta"
        organizationId="org-1"
        mountTime={0}
        onBack={vi.fn()}
        density="comfortable"
        isMobile={false}
      />
    </QueryClientProvider>,
  );
}

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

const field = () => screen.getByPlaceholderText("Responder no Direct…");

describe("SocialComposer — colar imagem", () => {
  beforeEach(() => {
    uploadMock.mockReset();
    uploadMock.mockResolvedValue({
      type: "image",
      url: "https://cdn/x.png",
      mime: "image/png",
      filename: "print-20261009-140507.png",
      sizeBytes: 2048,
    });
  });

  it("imagem colada sobe pelo mesmo caminho do clipe e vira o anexo", async () => {
    renderView();
    const png = new File(["x"], "image.png", { type: "image/png" });
    const ev = paste(field(), clipboard({ images: [png] }));
    expect(ev.defaultPrevented).toBe(true);
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    const [file, org, canal] = uploadMock.mock.calls[0];
    expect((file as File).type).toBe("image/png");
    expect((file as File).name).toMatch(/^print-\d{8}-\d{6}\.png$/);
    expect(org).toBe("org-1");
    expect(canal).toBe("instagram");
    expect(await screen.findByText("print-20261009-140507.png")).toBeInTheDocument();
  });

  it("texto colado segue nativo, sem upload", () => {
    renderView();
    const ev = paste(field(), clipboard({ text: "oi, tudo bem?" }));
    expect(ev.defaultPrevented).toBe(false);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("com envio em andamento a colagem não troca o anexo", () => {
    renderView(true);
    const png = new File(["x"], "image.png", { type: "image/png" });
    paste(field(), clipboard({ images: [png] }));
    expect(uploadMock).not.toHaveBeenCalled();
  });
});
