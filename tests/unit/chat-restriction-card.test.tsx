/**
 * Cartão da política de isolamento em Pilotos (#1636).
 *
 * O que importa aqui é comportamento de decisão, não pixel: quem enxerga o
 * cartão, se ligar exige confirmação com os números DAQUELA org, se desligar é
 * imediato, e se o atalho leva ao recorte certo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

const mockIdentity = vi.fn();
vi.mock("@/modules/identity", () => ({
  useIdentity: () => mockIdentity(),
}));

const rpc = vi.fn();
const singleFn = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({
      select: () => ({ eq: () => ({ single: () => singleFn() }) }),
    }),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatRestrictionCard } from "@/modules/identity/org-team/components/team/ChatRestrictionCard";

const ORG = "00000000-0000-0000-0000-000000000001";

/**
 * O switch nasce desabilitado enquanto a query do estado atual carrega — isso é
 * correto (clicar antes de saber o estado ligaria às cegas). O teste espera,
 * em vez de clicar num controle inerte e concluir que "nada aconteceu".
 */
async function switchPronto() {
  const sw = await screen.findByRole("switch");
  await waitFor(() => expect(sw.hasAttribute("disabled")).toBe(false));
  return sw;
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChatRestrictionCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIdentity.mockReturnValue({ isAdmin: true, isMaster: false, organizationId: ORG });
  singleFn.mockResolvedValue({ data: { chat_restrict_to_owner: false }, error: null });
  rpc.mockImplementation((name: string) => {
    if (name === "preview_chat_restriction") {
      return Promise.resolve({
        data: { conversas_total: 4947, conversas_restritas: 4775, leads_sem_responsavel: 312 },
        error: null,
      });
    }
    return Promise.resolve({ data: true, error: null });
  });
});

describe("ChatRestrictionCard", () => {
  it("membro não enxerga o cartão", () => {
    mockIdentity.mockReturnValue({ isAdmin: false, isMaster: false, organizationId: ORG });
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it("admin enxerga o cartão — controle positivo", async () => {
    renderCard();
    expect(await screen.findByText(/Isolamento por respons/i)).toBeTruthy();
  });

  it("master enxerga o cartão mesmo sem ser admin da org", async () => {
    mockIdentity.mockReturnValue({ isAdmin: false, isMaster: true, organizationId: ORG });
    renderCard();
    expect(await screen.findByText(/Isolamento por respons/i)).toBeTruthy();
  });

  it("ligar NÃO aplica direto — abre a confirmação com os números da org", async () => {
    renderCard();
    fireEvent.click(await switchPronto());

    // Os números da org aparecem, formatados
    expect(await screen.findByText("4.947")).toBeTruthy();
    expect(await screen.findByText("4.775")).toBeTruthy();
    expect(await screen.findByText("312")).toBeTruthy();
    // E a proporção, que é o que decide
    expect(await screen.findByText(/97% das conversas/)).toBeTruthy();

    // Nada foi aplicado ainda
    expect(rpc).not.toHaveBeenCalledWith("set_org_chat_restriction", expect.anything());
  });

  it("confirmar aplica a política pela RPC", async () => {
    renderCard();
    fireEvent.click(await switchPronto());
    fireEvent.click(await screen.findByRole("button", { name: /Ligar mesmo assim/i }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("set_org_chat_restriction", {
        p_org_id: ORG,
        p_enabled: true,
      }),
    );
  });

  it("o atalho leva ao recorte de leads sem responsável", async () => {
    renderCard();
    fireEvent.click(await switchPronto());
    fireEvent.click(await screen.findByRole("button", { name: /Atribuir respons/i }));

    expect(mockNavigate).toHaveBeenCalledWith("/leads?atribuicao=sem-responsavel");
    // E não ligou nada no caminho
    expect(rpc).not.toHaveBeenCalledWith("set_org_chat_restriction", expect.anything());
  });

  it("desligar é imediato — sem confirmação destrutiva", async () => {
    singleFn.mockResolvedValue({ data: { chat_restrict_to_owner: true }, error: null });
    renderCard();

    const sw = await switchPronto();
    await waitFor(() => expect(sw.getAttribute("data-state")).toBe("checked"));
    fireEvent.click(sw);

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("set_org_chat_restriction", {
        p_org_id: ORG,
        p_enabled: false,
      }),
    );
    expect(screen.queryByText(/Ligar mesmo assim/i)).toBeNull();
  });
});
