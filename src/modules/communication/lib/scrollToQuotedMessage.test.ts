// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scrollToQuotedMessage } from "./scrollToQuotedMessage";

function mockMatchMedia(reduced: boolean) {
  window.matchMedia = ((q: string) => ({ matches: reduced && q.includes("reduce"), media: q })) as unknown as typeof window.matchMedia;
}

describe("scrollToQuotedMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div data-wa-message-id="5511:ABC"></div><div data-provider-message-id="prov-1"></div>';
    Element.prototype.scrollIntoView = vi.fn();
    mockMatchMedia(false);
  });
  afterEach(() => vi.useRealTimers());

  it("rola suave até a bolha e destaca por um instante", () => {
    const alvo = document.querySelector<HTMLElement>('[data-wa-message-id="5511:ABC"]')!;
    expect(scrollToQuotedMessage("5511:ABC")).toBe(true);
    expect(alvo.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(alvo.classList.contains("ring-2")).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(alvo.classList.contains("ring-2")).toBe(false);
  });

  it("acha também pelo id estável do provedor (canal oficial)", () => {
    expect(scrollToQuotedMessage("prov-1")).toBe(true);
  });

  it("prefers-reduced-motion: salto direto, sem animação", () => {
    mockMatchMedia(true);
    const alvo = document.querySelector<HTMLElement>('[data-wa-message-id="5511:ABC"]')!;
    scrollToQuotedMessage("5511:ABC");
    expect(alvo.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("mensagem fora da thread carregada: false e nada quebra", () => {
    expect(scrollToQuotedMessage("nao-existe")).toBe(false);
    expect(scrollToQuotedMessage(null)).toBe(false);
    expect(scrollToQuotedMessage('com"aspas')).toBe(false);
  });
});
