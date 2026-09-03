import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDegrauDoSlot } from "./useDegrauDoSlot";

/**
 * O dublê de `ResizeObserver` do setup global é no-op: nunca chama de volta.
 * Serve para os primitivos do Radix não estourarem, mas não prova re-medição.
 * Este aqui guarda o retorno de chamada e deixa disparar à mão.
 */
function observerControlavel() {
  const chamadas: ResizeObserverCallback[] = [];
  const original = globalThis.ResizeObserver;
  const observados: Element[] = [];
  class Controlavel {
    constructor(cb: ResizeObserverCallback) {
      chamadas.push(cb);
    }
    observe(alvo: Element) {
      observados.push(alvo);
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = Controlavel as unknown as typeof ResizeObserver;
  return {
    disparar: () => chamadas.forEach((cb) => cb([], {} as ResizeObserver)),
    restaurar: () => {
      globalThis.ResizeObserver = original;
    },
    get observados() {
      return observados;
    },
  };
}

function mudarAltura(el: HTMLElement, altura: number) {
  Object.defineProperty(el, "offsetHeight", {
    configurable: true,
    value: altura,
  });
}

/**
 * Fixa a altura de um elemento como o layout a veria. jsdom não faz layout, e
 * `offsetHeight` é sempre 0 sem isto.
 */
function comAltura(altura: number): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "offsetHeight", {
    configurable: true,
    value: altura,
  });
  document.body.appendChild(el);
  return el;
}

function refPara(el: HTMLElement) {
  return { current: el };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useDegrauDoSlot", () => {
  it("mede a lateral, não a janela", () => {
    // A janela é alta; a lateral é baixa. Só a lateral vale.
    window.innerHeight = 768;

    const { result } = renderHook(() =>
      useDegrauDoSlot({
        lateralRef: refPara(comAltura(560)),
        topoRef: refPara(comAltura(96)),
        rodapeRef: refPara(comAltura(180)),
        navRef: refPara(comAltura(400)),
        colapsada: false,
        temBriefing: true,
      }),
    );

    // Pela lateral (560): sobra negativa, resta o ícone acima do piso.
    // Pela janela (768): sobraria 92px e daria "linha" — o degrau errado.
    expect(result.current).toBe("icone");
  });

  it("re-mede quando a lateral encolhe — o degrau acompanha sem remontar", () => {
    const observer = observerControlavel();
    try {
      const lateral = comAltura(900);
      const { result } = renderHook(() =>
        useDegrauDoSlot({
          lateralRef: refPara(lateral),
          topoRef: refPara(comAltura(96)),
          rodapeRef: refPara(comAltura(180)),
          navRef: refPara(comAltura(400)),
          colapsada: false,
          temBriefing: true,
        }),
      );
      expect(result.current).toBe("card");

      mudarAltura(lateral, 560);
      act(() => observer.disparar());

      expect(result.current).toBe("icone");
    } finally {
      observer.restaurar();
    }
  });

  it("recolher a lateral re-mede sem esperar o observador", () => {
    const elementos = {
      lateralRef: refPara(comAltura(900)),
      topoRef: refPara(comAltura(96)),
      rodapeRef: refPara(comAltura(180)),
      navRef: refPara(comAltura(400)),
      temBriefing: true,
    };

    const { result, rerender } = renderHook(
      ({ colapsada }: { colapsada: boolean }) =>
        useDegrauDoSlot({ ...elementos, colapsada }),
      { initialProps: { colapsada: false } },
    );
    expect(result.current).toBe("card");

    rerender({ colapsada: true });

    expect(result.current).toBe("icone");
  });

  it("observa a lateral, e não outro elemento qualquer da página", () => {
    // Sem isto, um observador apontado para o corpo da página passaria nos
    // outros casos: o dublê dispara todos os retornos de chamada, seja qual
    // for o alvo. Aqui o alvo é a asserção.
    const observer = observerControlavel();
    try {
      const lateral = comAltura(900);
      const nav = comAltura(400);
      renderHook(() =>
        useDegrauDoSlot({
          lateralRef: refPara(lateral),
          topoRef: refPara(comAltura(96)),
          rodapeRef: refPara(comAltura(180)),
          navRef: refPara(nav),
          colapsada: false,
          temBriefing: true,
        }),
      );

      expect(observer.observados).toContain(lateral);
      expect(observer.observados).not.toContain(document.body);
    } finally {
      observer.restaurar();
    }
  });
});
