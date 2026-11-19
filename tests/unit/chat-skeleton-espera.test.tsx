/**
 * ChatSkeleton — o esqueleto único do /chat-whatsapp (régua de espera, CP-v2):
 * a forma aparece desde o primeiro quadro (é o fallback do Suspense) e a frase
 * entra aos 1 s numa região aria-live.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatSkeleton, ListaDeConversasSkeleton } from "@/modules/communication/components/chat/ChatSkeleton";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("ChatSkeleton", () => {
  it("forma visível desde o primeiro quadro, sem spinner", () => {
    const { container } = render(<ChatSkeleton />);
    expect(screen.getByRole("group", { name: "Carregando conversa" })).toHaveAttribute("aria-busy", "true");
    // Sem texto sr-only redundante e sem região viva fora da frase.
    expect(screen.queryByText("Carregando conversa…")).toBeNull();
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(0);
    expect(container.querySelector("[role='status']")).toBeNull();
    expect(container.querySelectorAll("[data-osso]").length).toBeGreaterThan(10);
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("frase só aos 1 s, anunciada com polidez", async () => {
    const frase = "Juntando conversas dos seus 3 números…";
    render(<ChatSkeleton frase={frase} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(screen.queryByText(frase)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText(frase).closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  });

  it("as linhas da lista usam a mesma forma do esqueleto da rota", () => {
    const { container } = render(<ListaDeConversasSkeleton linhas={3} />);
    expect(container.querySelectorAll("[data-osso]")).toHaveLength(9);
  });
});
