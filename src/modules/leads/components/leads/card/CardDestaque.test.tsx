import { act, fireEvent, render, screen } from "@testing-library/react";
import { __reiniciarEfeitosDoCard, destacarCard, DESTAQUE_SAIDA_MS } from "../../../lib/card-effects";
import { CardDestaque } from "./CardDestaque";

function Card({ entryId }: { entryId: string }) {
  return (
    <div data-testid={`card-${entryId}`} data-lead-id={entryId}>
      <CardDestaque entryId={entryId} />
      <span>Bar do Zé</span>
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  __reiniciarEfeitosDoCard();
});
afterEach(() => {
  __reiniciarEfeitosDoCard();
  vi.useRealTimers();
});

describe("CardDestaque", () => {
  it("sem destaque, não há camada nenhuma", () => {
    render(<Card entryId="e-1" />);
    expect(screen.queryByTestId("card-destaque")).toBeNull();
  });

  it("destacado: três camadas por cima do card, sem capturar clique, fora da leitura de tela", () => {
    render(<Card entryId="e-1" />);
    act(() => destacarCard("e-1"));
    const camada = screen.getByTestId("card-destaque");
    expect(camada).toHaveClass("card-destaque");
    expect(camada).toHaveAttribute("aria-hidden");
    expect(camada.querySelectorAll("span")).toHaveLength(3);
  });

  it("o pouso agendado vira atraso positivo; o card que remonta no meio, atraso negativo", () => {
    const { unmount } = render(<Card entryId="e-1" />);
    act(() => destacarCard("e-1", { inicio: performance.now() + 700 }));
    expect(screen.getByTestId("card-destaque").style.getPropertyValue("--destaque-atraso")).toBe("700ms");
    unmount();

    act(() => vi.advanceTimersByTime(1500));
    render(<Card entryId="e-1" />);
    expect(screen.getByTestId("card-destaque").style.getPropertyValue("--destaque-atraso")).toBe("-800ms");
  });

  it("o atraso é medido UMA vez: re-render (a saída) não reinicia a animação", () => {
    render(<Card entryId="e-1" />);
    act(() => destacarCard("e-1"));
    const antes = screen.getByTestId("card-destaque").style.getPropertyValue("--destaque-atraso");
    act(() => vi.advanceTimersByTime(900));
    fireEvent.pointerDown(screen.getByTestId("card-e-1"));
    const camada = screen.getByTestId("card-destaque");
    expect(camada).toHaveAttribute("data-saindo");
    expect(camada.style.getPropertyValue("--destaque-atraso")).toBe(antes);
  });

  it("tocar no card é o 'achei': o brilho sai e some", () => {
    render(<Card entryId="e-1" />);
    act(() => destacarCard("e-1"));
    fireEvent.pointerDown(screen.getByTestId("card-e-1"));
    act(() => vi.advanceTimersByTime(DESTAQUE_SAIDA_MS));
    expect(screen.queryByTestId("card-destaque")).toBeNull();
  });

  it("só o card destacado brilha", () => {
    render(
      <>
        <Card entryId="e-1" />
        <Card entryId="e-2" />
      </>,
    );
    act(() => destacarCard("e-2"));
    expect(screen.getByTestId("card-e-1").querySelector(".card-destaque")).toBeNull();
    expect(screen.getByTestId("card-e-2").querySelector(".card-destaque")).not.toBeNull();
  });
});
