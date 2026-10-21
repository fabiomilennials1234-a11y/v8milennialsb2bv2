/**
 * Bolha longa desenhada POR BAIXO das seguintes (Chamado 6885e65d).
 *
 * Acima de 100 itens a thread é virtualizada: cada item é `position:absolute`
 * em `translateY(start)`, e `start` sai da altura MEDIDA do item anterior — ou
 * da estimativa (80 px) enquanto ele não foi medido. A bolha longa do print
 * ficou com a estimativa e as três seguintes subiram por cima dela.
 *
 * O porquê está no `@tanstack/virtual-core` 3.14: durante um
 * `scrollToIndex(..., { behavior: "smooth" })`, `shouldMeasureDuringScroll`
 * DESCARTA a medição de todo item fora de `alvo ± max(overscan, metade da faixa
 * visível)` — tanto a do ref (mount) quanto a do ResizeObserver. O observer só
 * avisa de novo se o tamanho mudar; um texto não muda. O item fica com a
 * estimativa enquanto estiver montado: a metade de cima da tela ao abrir a
 * conversa (o auto-scroll rola suave até a última mensagem).
 *
 * jsdom não tem layout nem ResizeObserver. O dublê daqui faz o que o navegador
 * faz: a altura real vem de `offsetHeight`, a rolagem é o evento `scroll`, e o
 * ResizeObserver ENTREGA a notificação inicial de cada elemento observado (o
 * stub global de `src/test/setup.ts` é mudo, e com ele até a rolagem do usuário
 * pareceria perder medidas). O `requestAnimationFrame` fica parado: modela o
 * scroll chegando antes do próximo frame de reconcile do virtualizer — que é
 * quando os itens do fim montam. O virtualizer é o de verdade.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { act, render as rtlRender } from "@testing-library/react";
import { createWrapper } from "../../../../../../tests/helpers/hook-test-utils";
import { MessageList, type MessageListProps } from "./MessageList";
import type { WhatsAppMessage } from "@/modules/communication/hooks/useWhatsAppChat";

vi.mock("@/shared/hooks/use-viewport", () => ({
  useViewport: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));

vi.mock("@/modules/communication/hooks/useMessageActions", () => ({
  useEditMessage: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  isFeatureUnavailable: () => false,
}));

const LONGA = "VALOR DA NOTA: R$ 1.000,00 — mensagem longa de teste que quebra em muitas linhas";
const ALTURA_VIEWPORT = 600;
const ALTURA_LONGA = 300;
const ALTURA_CURTA = 60;
const TOTAL = 120;
/** Seis antes do fim, como a bolha do print. */
const INDICE_LONGA = TOTAL - 7;

const originais = {
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight"),
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"),
  resizeObserver: globalThis.ResizeObserver,
};

/**
 * ResizeObserver com a semântica do navegador: avisa quando o tamanho difere do
 * último reportado (o inicial é 0), e só quando a página "pinta" — aqui,
 * `entregarResizeObserver()`.
 */
const observadores = new Set<ResizeObserverDuble>();
class ResizeObserverDuble {
  private readonly ultimo = new Map<Element, number>();
  constructor(private readonly callback: ResizeObserverCallback) {
    observadores.add(this);
  }
  observe(alvo: Element) {
    if (!this.ultimo.has(alvo)) this.ultimo.set(alvo, 0);
  }
  unobserve(alvo: Element) {
    this.ultimo.delete(alvo);
  }
  disconnect() {
    this.ultimo.clear();
    observadores.delete(this);
  }
  entregar() {
    const entradas: Array<Pick<ResizeObserverEntry, "target" | "borderBoxSize">> = [];
    for (const [alvo, anterior] of this.ultimo) {
      const el = alvo as HTMLElement;
      const altura = el.offsetHeight;
      if (altura === anterior) continue;
      this.ultimo.set(alvo, altura);
      entradas.push({ target: alvo, borderBoxSize: [{ blockSize: altura, inlineSize: el.offsetWidth }] });
    }
    if (entradas.length) this.callback(entradas as ResizeObserverEntry[], this as unknown as ResizeObserver);
  }
}
function entregarResizeObserver() {
  for (const o of observadores) o.entregar();
}

beforeEach(() => {
  observadores.clear();
  globalThis.ResizeObserver = ResizeObserverDuble as unknown as typeof ResizeObserver;
  let id = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => ++id);
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.ResizeObserver = originais.resizeObserver;
});

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute("data-radix-scroll-area-viewport")) return ALTURA_VIEWPORT;
      if (this.hasAttribute("data-index")) return this.textContent?.includes(LONGA) ? ALTURA_LONGA : ALTURA_CURTA;
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-radix-scroll-area-viewport") ? 800 : 0;
    },
  });
});

afterAll(() => {
  if (originais.offsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originais.offsetHeight);
  if (originais.offsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", originais.offsetWidth);
});

function msg(i: number): WhatsAppMessage {
  const ts = new Date(Date.UTC(2026, 9, 14, 8, i)).toISOString();
  const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  return {
    id,
    organization_id: "org-1",
    instance_id: "inst-1",
    message_id: `wamid-${i}`,
    remote_jid: "120000000000000000@g.us",
    phone_number: "120000000000000000",
    direction: "incoming",
    message_type: "text",
    content: i === INDICE_LONGA ? LONGA : `mensagem ${i}`,
    media_url: null,
    push_name: "Participante Teste",
    is_group: true,
    status: "received",
    lead_id: null,
    timestamp: ts,
    created_at: ts,
    sent_by_ai: false,
  } as unknown as WhatsAppMessage;
}

function props(): MessageListProps {
  return {
    messages: Array.from({ length: TOTAL }, (_, i) => msg(i)),
    transferEvents: [],
    failedMessages: [],
    calls: [],
    isLoading: false,
    contactName: "Grupo Teste",
    instanceName: "Comercial",
    lastReadAt: 0,
    // Nada "chega depois" da montagem: sem animação de entrada no meio da medida.
    mountTime: Number.MAX_SAFE_INTEGER,
    onImagePreview: vi.fn(),
    onRetry: vi.fn(),
    onOpenTemplates: vi.fn(),
  };
}

function inicio(el: HTMLElement): number {
  const m = /translateY\((-?[\d.]+)px\)/.exec(el.style.transform);
  if (!m) throw new Error(`item sem translateY: ${el.style.transform}`);
  return Number(m[1]);
}

describe("MessageList virtualizada — nenhuma bolha invade a seguinte", () => {
  it("abrir a conversa e rolar até o fim mede a bolha longa (slot = altura real, não a estimativa)", async () => {
    const { container } = rtlRender(<MessageList {...props()} />, { wrapper: createWrapper() });
    expect(container.querySelector("[data-testid='virtual-container']")).not.toBeNull();
    await act(async () => {
      entregarResizeObserver();
    });

    // O auto-scroll de abertura já pediu a última mensagem. O navegador chega
    // lá embaixo: o `scroll` monta os itens do fim enquanto o pedido está vivo.
    const viewport = container.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!viewport) throw new Error("viewport do ScrollArea não montou");
    const total = container.querySelector<HTMLElement>("[data-testid='virtual-container']")?.style.height;
    const fundo = Number.parseFloat(total ?? "0") - ALTURA_VIEWPORT;
    Object.defineProperty(viewport, "scrollTop", { configurable: true, writable: true, value: fundo });
    await act(async () => {
      viewport.dispatchEvent(new Event("scroll"));
    });
    // A página pinta: o ResizeObserver avisa a altura de cada item recém-montado.
    await act(async () => {
      entregarResizeObserver();
    });

    const itens = Array.from(container.querySelectorAll<HTMLElement>("[data-index]")).sort(
      (a, b) => Number(a.dataset.index) - Number(b.dataset.index),
    );
    const longa = itens.find((el) => Number(el.dataset.index) === INDICE_LONGA);
    const seguinte = itens.find((el) => Number(el.dataset.index) === INDICE_LONGA + 1);
    if (!longa || !seguinte) throw new Error("a bolha longa e a seguinte deviam estar montadas no fim da conversa");

    // O slot da longa é a distância até a próxima. Com o defeito, 80 (estimativa).
    expect(inicio(seguinte) - inicio(longa)).toBe(ALTURA_LONGA);

    // E a invariante geral: nenhum item montado começa antes do fim do anterior.
    for (let i = 1; i < itens.length; i++) {
      const anterior = itens[i - 1];
      expect(inicio(itens[i])).toBeGreaterThanOrEqual(inicio(anterior) + anterior.offsetHeight);
    }
  });
});
