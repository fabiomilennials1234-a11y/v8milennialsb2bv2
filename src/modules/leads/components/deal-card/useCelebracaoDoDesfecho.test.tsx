import { useRef } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const movimento = vi.hoisted(() => ({ reduzido: false }));
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: () => movimento.reduzido,
}));

const { useCelebracaoDoDesfecho } = await import("./useCelebracaoDoDesfecho");

let api: ReturnType<typeof useCelebracaoDoDesfecho>;

function Painel() {
  const ref = useRef<HTMLDivElement>(null);
  api = useCelebracaoDoDesfecho(ref);
  return (
    <div ref={ref} className="relative">
      {api.camada}
      <button data-desfecho="won">Ganhou</button>
      <button data-desfecho="lost">Perdeu</button>
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  movimento.reduzido = false;
});
afterEach(() => vi.useRealTimers());

describe("celebração do desfecho no painel", () => {
  it("lê a origem do voo no botão clicado — antes da RPC, enquanto ele existe", () => {
    render(<Painel />);
    const botao = screen.getByText("Ganhou");
    const rect = { left: 900, top: 20, width: 90, height: 30 } as DOMRect;
    botao.getBoundingClientRect = () => rect;
    expect(api.origemDo("won")).toBe(rect);
  });

  it("nada aparece até o banco confirmar; depois, a camada do ganho", () => {
    render(<Painel />);
    expect(screen.queryByTestId("celebracao-won")).toBeNull();
    act(() => api.celebrar("won", null));
    expect(screen.getByTestId("celebracao-won")).toBeInTheDocument();
  });

  it("a perda mostra a sua camada, e ela sai sozinha no fim da animação", () => {
    render(<Painel />);
    act(() => api.celebrar("lost", null));
    expect(screen.getByTestId("celebracao-lost")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2400));
    expect(screen.queryByTestId("celebracao-lost")).toBeNull();
  });

  it("confete só no ganho, depois do impacto", () => {
    render(<Painel />);
    act(() => api.celebrar("won", null));
    const camada = screen.getByTestId("celebracao-won");
    expect(camada.querySelector("canvas")).toBeNull();
    act(() => vi.advanceTimersByTime(1100));
    expect(camada.querySelector("canvas")).not.toBeNull();
    expect(screen.getByText("Negócio ganho")).toBeInTheDocument();
  });

  it("a camada não captura clique: o painel segue usável durante a animação", () => {
    render(<Painel />);
    act(() => api.celebrar("won", null));
    expect(screen.getByTestId("celebracao-won")).toHaveClass("pointer-events-none");
  });

  it("com movimento reduzido, não há celebração", () => {
    movimento.reduzido = true;
    render(<Painel />);
    act(() => api.celebrar("won", null));
    expect(screen.queryByTestId("celebracao-won")).toBeNull();
  });
});
