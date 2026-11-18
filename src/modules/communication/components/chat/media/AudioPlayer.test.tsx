import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioPlayer } from "./AudioPlayer";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
  } },
}));

const createObjectURL = vi.fn(() => "blob:https://torquecrm.com.br/audio-preview");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("AudioPlayer — prévia antes do upload", () => {
  it("reproduz o áudio local por blob permitido pela CSP e libera a URL após o upload", async () => {
    const { container, rerender } = render(
      <AudioPlayer src="data:audio/mpeg;base64,SUQz" isOutgoing />,
    );
    await waitFor(() => expect(container.querySelector("audio")).toHaveAttribute(
      "src", "blob:https://torquecrm.com.br/audio-preview",
    ));
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: "audio/mpeg", size: 3 }));
    expect(screen.queryByText("URL do áudio inválida.")).not.toBeInTheDocument();

    rerender(<AudioPlayer src="https://example.test/audio.mp3" isOutgoing />);
    expect(container.querySelector("audio")).toHaveAttribute("src", "https://example.test/audio.mp3");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:https://torquecrm.com.br/audio-preview");
  });

  it("libera a prévia ao sair da conversa", async () => {
    const { container, unmount } = render(<AudioPlayer src="data:audio/mpeg;base64,SUQz" isOutgoing />);
    await waitFor(() => expect(container.querySelector("audio")).not.toBeNull());
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:https://torquecrm.com.br/audio-preview");
  });

  it.each(["data:text/html;base64,SUQz", "data:audio/mpeg;base64,%%%", "javascript:alert(1)"])(
    "recusa conteúdo inválido: %s", async (src) => {
      const { container } = render(<AudioPlayer src={src} isOutgoing />);
      expect(await screen.findByText("URL do áudio inválida.")).toBeInTheDocument();
      expect(container.querySelector("audio")).toBeNull();
      expect(createObjectURL).not.toHaveBeenCalled();
    },
  );
});
