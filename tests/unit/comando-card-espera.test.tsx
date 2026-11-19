/**
 * Card "Conversas aguardando" pela régua de espera (CP-v2): nada antes de
 * 100 ms, esqueleto com a forma do card, frase aos 1 s, e o útil do Comando
 * marcado quando a fila resolve.
 */
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fila: {
    items: [] as unknown[], total: 0, isLoading: true, isError: false, isDegraded: false,
    isAdmin: true, semChips: false, chipsComErro: 0, refetch: () => {},
  },
  marcarUtil: vi.fn(),
}));

vi.mock("@/modules/analytics/hooks/useConversasAguardando", () => ({ useConversasAguardando: () => h.fila }));
vi.mock("@/core/perf/useMarcarUtil", () => ({ useMarcarUtil: h.marcarUtil }));
vi.mock("@/shared/hooks/use-viewport", () => ({ useViewport: () => ({ isMobile: false }) }));
vi.mock("@/modules/copilot", () => ({ useCopilotToggleStatus: () => ({ isLoading: false, data: null }) }));
vi.mock("@/modules/leads", () => ({ QUALIFICATION_TIER_CONFIG: {} }));
vi.mock("@/modules/communication/components/chat/AbrirConversaButton", () => ({ AbrirConversaButton: () => null }));
vi.mock("@/modules/analytics/hooks/useFocoDoLead", () => ({ useFocoDoLead: () => ({ isLoading: false, data: null }) }));

import { CardConversasAguardando } from "@/modules/analytics/components/dashboard/v2/CardConversasAguardando";

const FRASE = "Procurando quem ficou sem resposta nas suas caixas…";
const montar = () => render(<MemoryRouter><CardConversasAguardando /></MemoryRouter>);
const espera = () => document.querySelector("[data-espera]");

beforeEach(() => {
  vi.useFakeTimers();
  h.fila = { ...h.fila, isLoading: true, items: [], total: 0 };
  h.marcarUtil.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("CardConversasAguardando — régua de espera", () => {
  it("nada visível antes de 100 ms; esqueleto depois; frase aos 1 s", async () => {
    montar();
    expect(espera()).toHaveAttribute("data-espera", "oculta");
    expect(screen.queryByText(FRASE)).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(espera()).toHaveAttribute("data-espera", "skeleton");
    expect(document.querySelectorAll("[data-osso]").length).toBeGreaterThan(0);
    expect(screen.queryByText(FRASE)).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(screen.getByText(FRASE)).toBeInTheDocument();
    expect(screen.getByText(FRASE).closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  });

  it("marca o útil do comando só quando a fila resolve", () => {
    const { rerender } = montar();
    expect(h.marcarUtil).toHaveBeenLastCalledWith("comando", false);
    h.fila = { ...h.fila, isLoading: false };
    rerender(<MemoryRouter><CardConversasAguardando /></MemoryRouter>);
    expect(h.marcarUtil).toHaveBeenLastCalledWith("comando", true);
  });

  it("fila resolvida mostra o estado do card, sem esqueleto", () => {
    h.fila = { ...h.fila, isLoading: false };
    montar();
    expect(espera()).toBeNull();
    expect(screen.getByText("Ninguém esperando")).toBeInTheDocument();
  });

  describe("esqueleto com a forma do card real (F1: sem salto de layout em nenhum breakpoint)", () => {
    const CONVERSA = {
      key: "k0", phoneNumber: "5511999990000", normalizedPhone: "5511999990000", displayName: "Marina Duarte",
      leadId: "lead-0", instanceId: "inst", instanceName: "Vendas", lastClientMessage: "Oi, ainda tem a proposta?",
      lastClientMessageAt: new Date(Date.now() - 42 * 60_000).toISOString(), aiReplied: false, aiRepliedAt: null,
      ownerTeamMemberId: null, ownerName: null,
    };
    /** Classes que decidem ordem, grade e altura — cor e borda podem diferir. */
    const DE_LAYOUT = /^(?:[a-z]+:)*(?:order-|grid|flex|gap-|min-h-|min-w-|p-|pt-|mt-auto|items-|col)/;
    const layout = (el: Element | null) =>
      (el?.getAttribute("class") ?? "").split(/\s+/).filter((c) => DE_LAYOUT.test(c)).sort();
    const parte = (raiz: ParentNode, nome: string) => raiz.querySelector(`[data-parte="${nome}"]`);

    function partesDoEsqueleto() {
      h.fila = { ...h.fila, isLoading: true, items: [], total: 0 };
      const r = montar();
      act(() => void vi.advanceTimersByTime(100));
      const raiz = espera()!;
      const partes = Object.fromEntries(
        ["grade", "lista", "foco", "cabecalho", "tiles", "acoes"].map((n) => [n, layout(parte(raiz, n))]),
      );
      const foco = parte(raiz, "foco");
      r.unmount();
      return { partes, foco };
    }

    function partesDoReal() {
      h.fila = { ...h.fila, isLoading: false, items: [CONVERSA], total: 1 };
      const r = montar();
      const partes = Object.fromEntries(
        ["grade", "lista", "foco", "cabecalho", "tiles", "acoes"].map((n) => [n, layout(parte(document, n))]),
      );
      r.unmount();
      return partes;
    }

    it("cada faixa do esqueleto tem as classes de grade/ordem/altura do card real", () => {
      const { partes: osso } = partesDoEsqueleto();
      const real = partesDoReal();
      for (const nome of Object.keys(real)) {
        expect(real[nome].length, `faixa ${nome} existe no real`).toBeGreaterThan(0);
        expect(osso[nome], `faixa ${nome}`).toEqual(real[nome]);
      }
    });

    it("abaixo de lg o cartão de foco do esqueleto vem em cima e nunca some", () => {
      const { foco } = partesDoEsqueleto();
      const classes = foco?.getAttribute("class")?.split(/\s+/) ?? [];
      expect(classes).toContain("order-1");
      expect(classes).toContain("lg:order-2");
      expect(classes).toContain("min-h-[340px]");
      expect(classes.some((c) => c === "hidden" || /^(sm|md|lg):block$/.test(c))).toBe(false);
    });
  });

  it("a frase quebra linha, nunca trunca", async () => {
    montar();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    const frase = screen.getByText(FRASE);
    expect(frase.className).not.toMatch(/\btruncate\b/);
    expect(frase.closest("p")?.className).not.toMatch(/\b(truncate|whitespace-nowrap)\b/);
  });
});
