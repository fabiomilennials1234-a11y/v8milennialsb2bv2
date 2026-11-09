import { describe, expect, it, vi } from "vitest";

import { ehLinkDeConversa, marcadorDeAbrirConversa, navegarParaAviso } from "./abrir-aviso";

const LINK = "/chat-whatsapp?instance=7aac7b5e-2533-4eec-aae1-29aff074f4bb&phone=553398674703";

describe("ehLinkDeConversa", () => {
  it("reconhece o link do chat, com e sem query", () => {
    expect(ehLinkDeConversa(LINK)).toBe(true);
    expect(ehLinkDeConversa("/chat-whatsapp")).toBe(true);
  });
  it("não confunde outras rotas", () => {
    expect(ehLinkDeConversa("/chat-whatsapp-x")).toBe(false);
    expect(ehLinkDeConversa("/agenda")).toBe(false);
    expect(ehLinkDeConversa(null)).toBe(false);
  });
});

describe("navegarParaAviso", () => {
  it("com a flag, link de conversa leva o marcador de remontar o chat", () => {
    const navigate = vi.fn();
    navegarParaAviso(navigate, LINK, true);
    expect(navigate).toHaveBeenCalledWith(LINK, { state: { abrirConversa: expect.any(Number) } });
  });
  it("sem a flag, navega como sempre", () => {
    const navigate = vi.fn();
    navegarParaAviso(navigate, LINK, false);
    expect(navigate).toHaveBeenCalledWith(LINK);
  });
  it("com a flag, link que não é de conversa navega como sempre", () => {
    const navigate = vi.fn();
    navegarParaAviso(navigate, "/agenda", true);
    expect(navigate).toHaveBeenCalledWith("/agenda");
  });
});

describe("marcadorDeAbrirConversa", () => {
  it("só aceita número", () => {
    expect(marcadorDeAbrirConversa({ abrirConversa: 5 })).toBe(5);
    expect(marcadorDeAbrirConversa({ abrirConversa: "5" })).toBeUndefined();
    expect(marcadorDeAbrirConversa(null)).toBeUndefined();
    expect(marcadorDeAbrirConversa(undefined)).toBeUndefined();
  });
});
