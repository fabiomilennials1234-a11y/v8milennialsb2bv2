/**
 * Bolha de documento (Chamado f6fc3c9e): mostra o nome original; sem nome,
 * "Documento" — nunca o hash ou o link `.enc?…` da URL.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageDocument } from "@/modules/communication/components/chat/media/MessageMedia";

const HASH_URL =
  "https://x.supabase.co/storage/v1/object/public/media/b8bd6f2750fa4c1e9d0a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4d82c3.pdf";
const ENC_URL = "https://mmg.whatsapp.net/v/t62.7119-24/838502491_123_n.enc?ccb=11-4&oh=abc&oe=def";

describe("MessageDocument", () => {
  it("mostra o nome original do arquivo", () => {
    render(<MessageDocument src={HASH_URL} fileName="Pedido JURERE - 03.10.26.pdf" isOutgoing={false} />);
    expect(screen.getByText("Pedido JURERE - 03.10.26.pdf")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe(HASH_URL);
  });

  it("o nome exibido é texto puro: nunca vira HTML", () => {
    render(<MessageDocument src={HASH_URL} fileName={'<img src=x onerror="alert(1)">.pdf'} isOutgoing={false} />);
    expect(screen.getByText('<img src=x onerror="alert(1)">.pdf')).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  it("sem nome mostra 'Documento', não o hash da URL", () => {
    render(<MessageDocument src={HASH_URL} isOutgoing={false} />);
    expect(screen.getByText("Documento")).toBeTruthy();
    expect(screen.queryByText(/b8bd6f2750fa/)).toBeNull();
  });

  it("sem nome mostra 'Documento', não o link .enc", () => {
    render(<MessageDocument src={ENC_URL} isOutgoing />);
    expect(screen.getByText("Documento")).toBeTruthy();
    expect(screen.queryByText(/\.enc/)).toBeNull();
  });
});

describe("MessageDocument — blob carregado sob demanda", () => {
  it("blob ganha download com o nome real; URL pública não", () => {
    const { unmount } = render(<MessageDocument src="blob:abc" fileName="Pedido.pdf" isOutgoing={false} />);
    expect(screen.getByRole("link").getAttribute("download")).toBe("Pedido.pdf");
    unmount();
    render(<MessageDocument src={HASH_URL} fileName="Pedido.pdf" isOutgoing={false} />);
    expect(screen.getByRole("link").hasAttribute("download")).toBe(false);
  });
});
