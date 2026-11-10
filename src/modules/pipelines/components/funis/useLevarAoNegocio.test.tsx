import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const efeitos = vi.hoisted(() => ({ destacar: vi.fn(), antecipar: vi.fn() }));
vi.mock("@/modules/leads", () => ({
  destacarCard: (...a: unknown[]) => efeitos.destacar(...a),
  anteciparDestaque: (...a: unknown[]) => efeitos.antecipar(...a),
  DESTAQUE_ANTECIPACAO_MS: 120,
}));

import { PRAZO_DA_CHEGADA_MS, useLevarAoNegocio, type AlvoDaCamera } from "./useLevarAoNegocio";
import { duracaoHorizontal } from "@/modules/pipelines/lib/rolar-ate-o-card";

/** Relógio manual dos quadros; o `setTimeout` é o fake do vitest. */
function relogioManual() {
  let t = 0;
  let fila: FrameRequestCallback[] = [];
  return {
    agora: () => t,
    raf: (cb: FrameRequestCallback) => {
      fila.push(cb);
      return fila.length;
    },
    cancelar: () => {},
    andar(ms: number) {
      t += ms;
      const rodar = fila;
      fila = [];
      for (const cb of rodar) cb(t);
    },
  };
}

function comCaixa<T extends HTMLElement>(el: T, r: { left?: number; top?: number; width?: number; height?: number }) {
  const caixa = { left: 0, top: 0, width: 0, height: 0, ...r };
  el.getBoundingClientRect = () =>
    ({ ...caixa, right: caixa.left + caixa.width, bottom: caixa.top + caixa.height, x: caixa.left, y: caixa.top, toJSON: () => caixa }) as DOMRect;
  return el;
}

/** Board com a coluna "novo" fora da tela e o card no topo dela. */
function montarBoard() {
  document.body.innerHTML = "";
  const barra = document.createElement("div");
  barra.setAttribute("data-quadro", "barra-topo");
  const trilho = comCaixa(document.createElement("div"), { left: 100, width: 1000, top: 150, height: 600 });
  trilho.setAttribute("data-quadro", "rolagem");
  trilho.style.overflowX = "auto";
  Object.defineProperty(trilho, "scrollWidth", { value: 3000 });
  Object.defineProperty(trilho, "clientWidth", { value: 1000 });
  const coluna = comCaixa(document.createElement("div"), { left: 1900, width: 300, top: 150, height: 600 });
  coluna.setAttribute("data-stage", "novo");
  const wrapper = document.createElement("div");
  wrapper.setAttribute("role", "button");
  wrapper.tabIndex = 0;
  const card = comCaixa(document.createElement("div"), { left: 1910, width: 280, top: 200, height: 120 });
  card.setAttribute("data-lead-id", "e-9");
  wrapper.appendChild(card);
  coluna.appendChild(wrapper);
  trilho.appendChild(coluna);
  document.body.append(barra, trilho);
  return { trilho, barra, wrapper };
}

const ALVO: AlvoDaCamera = { entryId: "e-9", stageKey: "novo", nonce: 1, nomeDoLead: "Bar do Zé", nomeDaEtapa: "Novo" };

type Props = { alvo: AlvoDaCamera | null; pronto: boolean; etapa?: string };

/** `pronto` = o card já está numa coluna (a "novo", salvo `etapa`). O registro é da página. */
function montar(props: Props, registro: { current: number | null } = { current: null }) {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const relogio = relogioManual();
  const onNaoDeu = vi.fn();
  const hook = renderHook(
    ({ alvo, pronto, etapa = "novo" }: Props) =>
      useLevarAoNegocio({ alvo, etapa: pronto ? etapa : null, pipelineId: "pl-1", registro, onNaoDeu, relogio }),
    { wrapper, initialProps: props },
  );
  return { ...hook, relogio, onNaoDeu, registro };
}

/** Quadros suficientes para achar o card parado. */
async function deixarAssentar(relogio: ReturnType<typeof relogioManual>) {
  for (let i = 0; i < 4; i++) {
    await act(async () => relogio.andar(16));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  efeitos.destacar.mockReset();
  efeitos.antecipar.mockReset();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useLevarAoNegocio", () => {
  it("não parte antes de o card fixado estar na coluna", async () => {
    montarBoard();
    const { relogio } = montar({ alvo: ALVO, pronto: false });
    await deixarAssentar(relogio);
    expect(efeitos.destacar).not.toHaveBeenCalled();
  });

  it("leva a tela até o card e agenda o pouso do brilho para o fim da câmera", async () => {
    const { trilho, barra } = montarBoard();
    const { result, relogio } = montar({ alvo: ALVO, pronto: true });
    await deixarAssentar(relogio);
    // A câmera parte depois da entrada das colunas (180 ms após montar).
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(efeitos.destacar).toHaveBeenCalledTimes(1);
    const [entryId, { inicio }] = efeitos.destacar.mock.calls[0] as [string, { inicio: number }];
    expect(entryId).toBe("e-9");
    expect(inicio).toBe(relogio.agora() + duracaoHorizontal(1450) - 120);
    expect(result.current.anuncio).toBe("Negócio de Bar do Zé na etapa Novo.");

    for (let i = 0; i < 60; i++) await act(async () => relogio.andar(16));
    expect(trilho.scrollLeft).toBe(1450);
    expect(barra.scrollLeft).toBe(1450);
    expect(efeitos.antecipar).not.toHaveBeenCalled();
  });

  it("uma viagem por pedido: re-render não repete; pedido novo (outro nonce) viaja de novo", async () => {
    montarBoard();
    const { relogio, rerender } = montar({ alvo: ALVO, pronto: true });
    await deixarAssentar(relogio);
    await act(async () => vi.advanceTimersByTimeAsync(200));
    rerender({ alvo: { ...ALVO }, pronto: true });
    await deixarAssentar(relogio);
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(efeitos.destacar).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 60; i++) await act(async () => relogio.andar(16));
    rerender({ alvo: { ...ALVO, nonce: 2 }, pronto: true });
    await deixarAssentar(relogio);
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(efeitos.destacar).toHaveBeenCalledTimes(2);
  });

  it("a pessoa rolou no meio: a câmera cede e o brilho vem para agora", async () => {
    const { trilho } = montarBoard();
    const { relogio } = montar({ alvo: ALVO, pronto: true });
    await deixarAssentar(relogio);
    await act(async () => vi.advanceTimersByTimeAsync(200));
    await act(async () => relogio.andar(16));
    await act(async () => relogio.andar(100));
    const noMeio = trilho.scrollLeft;
    await act(async () => {
      window.dispatchEvent(new Event("wheel"));
      relogio.andar(16);
    });
    for (let i = 0; i < 40; i++) await act(async () => relogio.andar(16));
    expect(trilho.scrollLeft).toBe(noMeio);
    expect(efeitos.antecipar).toHaveBeenCalledWith("e-9");
  });

  it("a pessoa tocou no próprio card no meio: a câmera cede e o brilho NÃO vem para agora", async () => {
    const { trilho } = montarBoard();
    const { relogio } = montar({ alvo: ALVO, pronto: true });
    await deixarAssentar(relogio);
    await act(async () => vi.advanceTimersByTimeAsync(200));
    await act(async () => relogio.andar(116));
    const noMeio = trilho.scrollLeft;
    const card = document.querySelector('[data-lead-id="e-9"]')!;
    await act(async () => {
      card.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    for (let i = 0; i < 40; i++) await act(async () => relogio.andar(16));
    expect(trilho.scrollLeft).toBe(noMeio);
    expect(efeitos.antecipar).not.toHaveBeenCalled();
  });

  it("o card nunca ficou pronto: avisa no prazo (a página oferece abrir o negócio)", async () => {
    montarBoard();
    const { onNaoDeu } = montar({ alvo: ALVO, pronto: false });
    await act(async () => vi.advanceTimersByTimeAsync(PRAZO_DA_CHEGADA_MS));
    expect(onNaoDeu).toHaveBeenCalledWith(ALVO);
    expect(efeitos.destacar).not.toHaveBeenCalled();
  });

  it("movimento reduzido: salta direto e o brilho toca na hora", async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
    const { trilho } = montarBoard();
    const { relogio } = montar({ alvo: ALVO, pronto: true });
    await deixarAssentar(relogio);
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(trilho.scrollLeft).toBe(1450);
    expect(efeitos.destacar).toHaveBeenCalledWith("e-9");
  });

  it("ativado pelo teclado no chat: o foco vai para o card", async () => {
    const { wrapper } = montarBoard();
    const { relogio } = montar({ alvo: { ...ALVO, viaTeclado: true }, pronto: true });
    await deixarAssentar(relogio);
    await act(async () => vi.advanceTimersByTimeAsync(200));
    for (let i = 0; i < 60; i++) await act(async () => relogio.andar(16));
    expect(document.activeElement).toBe(wrapper);
  });

  it("pelo teclado, mas a pessoa foi digitar no meio: o foco fica onde ela pôs", async () => {
    montarBoard();
    const busca = document.createElement("input");
    document.body.appendChild(busca);
    const { relogio } = montar({ alvo: { ...ALVO, viaTeclado: true }, pronto: true });
    await deixarAssentar(relogio);
    await act(async () => vi.advanceTimersByTimeAsync(200));
    await act(async () => relogio.andar(116));
    await act(async () => {
      busca.focus();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    });
    for (let i = 0; i < 60; i++) await act(async () => relogio.andar(16));
    expect(document.activeElement).toBe(busca);
  });

  it("o board remonta (aba Lista → Kanban): a chegada não se repete nem avisa à toa", async () => {
    const { trilho } = montarBoard();
    const primeira = montar({ alvo: ALVO, pronto: true });
    await deixarAssentar(primeira.relogio);
    await act(async () => vi.advanceTimersByTimeAsync(200));
    for (let i = 0; i < 60; i++) await act(async () => primeira.relogio.andar(16));
    expect(efeitos.destacar).toHaveBeenCalledTimes(1);
    primeira.unmount();

    trilho.scrollLeft = 0;
    const segunda = montar({ alvo: ALVO, pronto: true }, primeira.registro);
    await deixarAssentar(segunda.relogio);
    await act(async () => vi.advanceTimersByTimeAsync(PRAZO_DA_CHEGADA_MS));
    for (let i = 0; i < 60; i++) await act(async () => segunda.relogio.andar(16));
    expect(efeitos.destacar).toHaveBeenCalledTimes(1);
    expect(trilho.scrollLeft).toBe(0);
    expect(segunda.onNaoDeu).not.toHaveBeenCalled();
  });

  it("gesto ANTES da partida (board ainda buscando): sem câmera; o brilho toca onde o card estiver", async () => {
    const { trilho } = montarBoard();
    const { relogio, rerender, onNaoDeu } = montar({ alvo: ALVO, pronto: false });
    await act(async () => {
      window.dispatchEvent(new Event("wheel"));
    });
    rerender({ alvo: ALVO, pronto: true });
    await deixarAssentar(relogio);
    await act(async () => vi.advanceTimersByTimeAsync(200));
    for (let i = 0; i < 60; i++) await act(async () => relogio.andar(16));
    expect(trilho.scrollLeft).toBe(0);
    expect(efeitos.destacar).toHaveBeenCalledWith("e-9");
    await act(async () => vi.advanceTimersByTimeAsync(PRAZO_DA_CHEGADA_MS));
    expect(onNaoDeu).not.toHaveBeenCalled();
  });

  it("gesto antes da partida e o card nunca aparece: o prazo passa calado", async () => {
    montarBoard();
    const { onNaoDeu } = montar({ alvo: ALVO, pronto: false });
    await act(async () => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    await act(async () => vi.advanceTimersByTimeAsync(PRAZO_DA_CHEGADA_MS));
    expect(onNaoDeu).not.toHaveBeenCalled();
  });

  it("a etapa mudou desde a decisão: a câmera mira a coluna em que o card está agora", async () => {
    const { trilho } = montarBoard();
    const { relogio } = montar({ alvo: { ...ALVO, stageKey: "velha" }, pronto: true, etapa: "novo" });
    await deixarAssentar(relogio);
    await act(async () => vi.advanceTimersByTimeAsync(200));
    for (let i = 0; i < 60; i++) await act(async () => relogio.andar(16));
    expect(trilho.scrollLeft).toBe(1450);
    expect(efeitos.destacar).toHaveBeenCalledTimes(1);
  });
});
