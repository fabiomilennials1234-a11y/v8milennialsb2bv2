import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatWhatsApp from "./ChatWhatsApp";

const montagens = vi.fn();
vi.mock("@/modules/communication/components/chat/ChatShellWithContext", () => ({
  ChatShellWithContext: () => {
    useEffect(() => { montagens(); }, []);
    return null;
  },
}));
vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ organizationId: "org" }) }));
vi.mock("@/lib/analytics", () => ({ trackModuleVisit: vi.fn() }));

let nav: NavigateFunction;
function Captura() {
  nav = useNavigate();
  return null;
}

function montar(entrada: { pathname: string; search?: string; state?: unknown }) {
  render(
    <MemoryRouter initialEntries={[entrada]}>
      <Captura />
      <ChatWhatsApp />
    </MemoryRouter>,
  );
}

beforeEach(() => montagens.mockClear());
afterEach(cleanup);

describe("ChatWhatsApp — aviso com o chat já aberto", () => {
  it("chegar pelo aviso monta o chat uma vez só", () => {
    montar({ pathname: "/chat-whatsapp", search: "?phone=1", state: { abrirConversa: 1 } });
    expect(montagens).toHaveBeenCalledTimes(1);
  });

  it("marcador novo remonta o chat (relê ?instance=&phone=)", () => {
    montar({ pathname: "/chat-whatsapp" });
    act(() => nav("/chat-whatsapp?instance=i&phone=553398674703", { state: { abrirConversa: 2 } }));
    expect(montagens).toHaveBeenCalledTimes(2);
  });

  it("limpar os params (replace sem state) não remonta", () => {
    montar({ pathname: "/chat-whatsapp", search: "?phone=1", state: { abrirConversa: 1 } });
    act(() => nav("/chat-whatsapp", { replace: true }));
    expect(montagens).toHaveBeenCalledTimes(1);
  });

  it("navegação comum (sem marcador) não remonta", () => {
    montar({ pathname: "/chat-whatsapp" });
    act(() => nav("/chat-whatsapp?phone=553398674703"));
    expect(montagens).toHaveBeenCalledTimes(1);
  });
});
