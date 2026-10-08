/**
 * Mídia sob demanda (Chamado 6dfcae6d, PR-B): link criptografado da CDN do
 * WhatsApp não abre no navegador. Em vez de <img> quebrada, a bolha mostra um
 * botão; o download só acontece no clique.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const downloadMedia = vi.fn();
vi.mock("@/modules/communication/lib/whatsappApi", () => ({
  downloadMedia: (...a: unknown[]) => downloadMedia(...a),
}));

import { OnDemandMedia } from "@/modules/communication/components/chat/media/OnDemandMedia";

const CDN = "https://mmg.whatsapp.net/v/t62.7118-24/123_n.enc?ccb=11-4&oh=abc";
const PUBLIC = "https://x.supabase.co/storage/v1/object/public/media/abc.jpg";
const PNG_B64 = "iVBORw0KGgo=";

beforeEach(() => {
  downloadMedia.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:fake-1");
  URL.revokeObjectURL = vi.fn();
});

describe("OnDemandMedia", () => {
  it("URL pública: renderiza direto, sem botão e sem download", () => {
    render(
      <OnDemandMedia kind="image" src={PUBLIC} instanceId="i1" messageId="m1">
        {(url) => <img alt="direto" src={url} />}
      </OnDemandMedia>,
    );
    expect(screen.getByAltText("direto").getAttribute("src")).toBe(PUBLIC);
    expect(screen.queryByRole("button")).toBeNull();
    expect(downloadMedia).not.toHaveBeenCalled();
  });

  it("link da CDN: mostra botão e NÃO baixa até o clique", () => {
    render(
      <OnDemandMedia kind="image" src={CDN} instanceId="i1" messageId="m1">
        {(url) => <img alt="x" src={url} />}
      </OnDemandMedia>,
    );
    expect(screen.getByRole("button", { name: /carregar imagem/i })).toBeTruthy();
    expect(screen.queryByAltText("x")).toBeNull();
    expect(downloadMedia).not.toHaveBeenCalled();
  });

  it("clique baixa pelo downloadMedia e entrega o blob ao filho", async () => {
    downloadMedia.mockResolvedValue({ base64: PNG_B64, mimetype: "image/png" });
    render(
      <OnDemandMedia kind="image" src={CDN} instanceId="i1" messageId="m1">
        {(url) => <img alt="carregada" src={url} />}
      </OnDemandMedia>,
    );
    fireEvent.click(screen.getByRole("button", { name: /carregar imagem/i }));
    await waitFor(() => expect(screen.getByAltText("carregada").getAttribute("src")).toBe("blob:fake-1"));
    expect(downloadMedia).toHaveBeenCalledWith("i1", "m1");
  });

  it("falha no download: mostra erro e permite tentar de novo", async () => {
    downloadMedia.mockRejectedValueOnce(new Error("boom"));
    render(
      <OnDemandMedia kind="document" src={CDN} instanceId="i1" messageId="m1">
        {(url) => <a href={url}>doc</a>}
      </OnDemandMedia>,
    );
    fireEvent.click(screen.getByRole("button", { name: /carregar documento/i }));
    await waitFor(() => expect(screen.getByText(/não foi possível/i)).toBeTruthy());
    downloadMedia.mockResolvedValueOnce({ base64: PNG_B64, mimetype: "application/pdf" });
    fireEvent.click(screen.getByRole("button", { name: /tentar de novo/i }));
    await waitFor(() => expect(screen.getByText("doc").getAttribute("href")).toBe("blob:fake-1"));
  });

  it("base64 vazio conta como falha", async () => {
    downloadMedia.mockResolvedValue({ base64: "", mimetype: "" });
    render(
      <OnDemandMedia kind="video" src={CDN} instanceId="i1" messageId="m1">
        {(url) => <video src={url} />}
      </OnDemandMedia>,
    );
    fireEvent.click(screen.getByRole("button", { name: /carregar vídeo/i }));
    await waitFor(() => expect(screen.getByText(/não foi possível/i)).toBeTruthy());
  });

  it("sem instanceId/messageId não há como baixar: cai no render normal", () => {
    render(
      <OnDemandMedia kind="image" src={CDN} instanceId={null} messageId={null}>
        {(url) => <img alt="fallback" src={url} />}
      </OnDemandMedia>,
    );
    expect(screen.getByAltText("fallback")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("desmontar revoga o blob", async () => {
    downloadMedia.mockResolvedValue({ base64: PNG_B64, mimetype: "image/png" });
    const { unmount } = render(
      <OnDemandMedia kind="image" src={CDN} instanceId="i1" messageId="m1">
        {(url) => <img alt="c" src={url} />}
      </OnDemandMedia>,
    );
    fireEvent.click(screen.getByRole("button", { name: /carregar imagem/i }));
    await waitFor(() => screen.getByAltText("c"));
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-1");
  });
});
