/**
 * A lixeira da Agenda tem que levar a um botão "Excluir" ALCANÇÁVEL.
 *
 * A lixeira não exclui em um clique: ela abre um bloco de confirmação no
 * rodapé do popover. Quando o compromisso está na metade de baixo da tela, o
 * card já foi grudado no fim da janela (`top = vh - altura - 16`), e o bloco
 * cresce o card ~72px PARA BAIXO. Sem reposicionar, os botões
 * Cancelar/Excluir nascem fora da janela — e o card é `position: fixed`, então
 * nenhuma rolagem os alcança. Medido no navegador (janela 640px, clique em
 * y=410): "Excluir" nascia 19px abaixo da borda, inclicável. Para quem usa, a
 * lixeira era um botão que não fazia nada.
 *
 * jsdom não faz layout, então aqui a altura é simulada e o `ResizeObserver` é
 * um de verdade (o stub global de `src/test/setup.ts` nunca dispara). O que
 * este arquivo trava é a LIGAÇÃO — se alguém tirar o observer e voltar a
 * depender só de `[x, y]`, o `top` para de mudar e estes testes reprovam.
 * A prova do pixel é a medição no navegador, não este arquivo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EventDetailPopover } from "@/modules/engagement/components/agenda/EventDetailPopover";
import type { UnifiedEvent } from "@/modules/engagement/components/agenda/agenda-helpers";

// ─── Alturas medidas no componente real, no navegador ────────────────────────
const ALTURA_FECHADO = 259;
const ALTURA_COM_CONFIRMACAO = 331;
const LARGURA = 288; // `w-72`
const JANELA_ALTURA = 640;
const JANELA_LARGURA = 1366;

const REUNIAO: UnifiedEvent = {
  id: "meeting-11111111-1111-1111-1111-111111111111",
  title: "Reunião com o lead",
  start: new Date(2026, 7, 25, 15, 0),
  end: new Date(2026, 7, 25, 16, 0),
  allDay: false,
  source: "meeting",
  color: "hsl(47, 100%, 50%)",
  description: null,
  location: null,
  meetLink: null,
  leadId: null,
  leadName: null,
  leadCompany: null,
  creatorName: "Ana Souza",
  createdBy: "user-ana",
  status: "scheduled",
  eventType: "meeting",
  googleEventId: null,
  googleHtmlLink: null,
  googleCalendarOwnerId: null,
  googleCalendarColor: null,
  googleCalendarOwnerName: null,
};

/** Callbacks do ResizeObserver vivo, para o teste disparar na hora certa. */
let observadores: Array<() => void> = [];

/**
 * O card é o único `div.fixed` da árvore. A altura simulada responde à
 * presença da confirmação — é isso que reproduz o crescimento real.
 */
function alturaSimulada(el: HTMLElement): number {
  if (!el.classList.contains("fixed")) return 0;
  return el.textContent?.includes("Excluir esta reuniao?")
    ? ALTURA_COM_CONFIRMACAO
    : ALTURA_FECHADO;
}

let offsetHeightOriginal: PropertyDescriptor | undefined;
let offsetWidthOriginal: PropertyDescriptor | undefined;

beforeEach(() => {
  observadores = [];

  offsetHeightOriginal = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  offsetWidthOriginal = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetWidth",
  );

  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return alturaSimulada(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("fixed") ? LARGURA : 0;
    },
  });

  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly cb: () => void) {}
      observe() {
        observadores.push(this.cb);
      }
      unobserve() {}
      disconnect() {
        observadores = observadores.filter((c) => c !== this.cb);
      }
    },
  );

  window.innerHeight = JANELA_ALTURA;
  window.innerWidth = JANELA_LARGURA;
});

afterEach(() => {
  if (offsetHeightOriginal) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeightOriginal);
  }
  if (offsetWidthOriginal) {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidthOriginal);
  }
  vi.unstubAllGlobals();
});

/** Simula o fim da animação `height: 0 → auto`, que é quem muda o tamanho. */
function cardTerminouDeCrescer() {
  act(() => {
    observadores.forEach((cb) => cb());
  });
}

function cardEl(): HTMLElement {
  return document.querySelector("div.fixed") as HTMLElement;
}

function topoDoCard(): number {
  return parseFloat(cardEl().style.top);
}

function abrir(y: number) {
  return render(
    <EventDetailPopover
      state={{ event: REUNIAO, x: 500, y }}
      onClose={vi.fn()}
      onDeleteMeeting={vi.fn().mockResolvedValue(undefined)}
      onDeleteGoogleEvent={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

describe("EventDetailPopover — a confirmação de exclusão cabe na tela", () => {
  it("compromisso embaixo: o card gruda no rodapé da janela", () => {
    abrir(410);
    expect(topoDoCard()).toBe(JANELA_ALTURA - ALTURA_FECHADO - 16);
  });

  /** O teste da regressão. */
  it("ao abrir a confirmação, o card SOBE para os botões continuarem na tela", async () => {
    const user = userEvent.setup();
    abrir(410);

    const topoAntes = topoDoCard();
    expect(topoAntes + ALTURA_FECHADO).toBeLessThanOrEqual(JANELA_ALTURA);

    await user.click(screen.getByTitle("Excluir evento"));
    expect(screen.getByText("Excluir esta reuniao?")).toBeInTheDocument();

    cardTerminouDeCrescer();

    const topoDepois = topoDoCard();
    expect(topoDepois).toBeLessThan(topoAntes);
    // O card inteiro — e portanto o botão "Excluir", que é a última coisa
    // dentro dele — termina acima da borda de baixo da janela.
    expect(topoDepois + ALTURA_COM_CONFIRMACAO).toBeLessThanOrEqual(JANELA_ALTURA);
  });

  it("compromisso no alto: nada se move, porque já cabia", async () => {
    const user = userEvent.setup();
    abrir(120);

    const topoAntes = topoDoCard();
    await user.click(screen.getByTitle("Excluir evento"));
    cardTerminouDeCrescer();

    expect(topoDoCard()).toBe(topoAntes);
    expect(topoAntes + ALTURA_COM_CONFIRMACAO).toBeLessThanOrEqual(JANELA_ALTURA);
  });

  it("o botão Excluir é o que dispara a exclusão — a lixeira só pergunta", async () => {
    const user = userEvent.setup();
    const onDeleteMeeting = vi.fn().mockResolvedValue(undefined);

    render(
      <EventDetailPopover
        state={{ event: REUNIAO, x: 500, y: 410 }}
        onClose={vi.fn()}
        onDeleteMeeting={onDeleteMeeting}
        onDeleteGoogleEvent={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await user.click(screen.getByTitle("Excluir evento"));
    expect(onDeleteMeeting).not.toHaveBeenCalled();

    cardTerminouDeCrescer();
    await user.click(screen.getByRole("button", { name: "Excluir" }));

    // Sem o prefixo de fonte — é o id da linha em `meetings`.
    expect(onDeleteMeeting).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
    );
  });

  it("card mais alto que a janela encosta no topo e rola por dentro", () => {
    window.innerHeight = 220;
    abrir(150);
    expect(topoDoCard()).toBe(8);
    expect(cardEl().className).toContain("overflow-y-auto");
  });
});
