import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { Espera, REGUA, deveNarrar, useFaseEspera } from "@/shared/espera";

const forma = <div data-testid="forma">forma real</div>;
const conteudo = <div data-testid="conteudo">dado real</div>;

function Tela({ carregando }: { carregando: boolean }) {
  return (
    <Espera carregando={carregando} forma={forma} frase="Juntando conversas…">
      {conteudo}
    </Espera>
  );
}

describe("régua de espera", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("contrato da régua", () => {
    expect(REGUA).toEqual({ invisivelMs: 100, skeletonMinMs: 300, fraseMs: 1000, narradoMs: 10_000 });
    expect(deveNarrar(null)).toBe(false);
    expect(deveNarrar(10_000)).toBe(false);
    expect(deveNarrar(10_001)).toBe(true);
  });

  describe("useFaseEspera", () => {
    it("oculta < 100 ms · skeleton ≥ 100 ms · +frase ≥ 1 s", () => {
      const { result } = renderHook(() => useFaseEspera(true));
      expect(result.current.fase).toBe("oculta");
      act(() => void vi.advanceTimersByTime(99));
      expect(result.current.fase).toBe("oculta");
      act(() => void vi.advanceTimersByTime(1));
      expect(result.current.fase).toBe("skeleton");
      act(() => void vi.advanceTimersByTime(899));
      expect(result.current.fase).toBe("skeleton");
      act(() => void vi.advanceTimersByTime(1));
      expect(result.current.fase).toBe("skeleton+frase");
    });

    it("skeleton visível segura até 300 ms desde que apareceu", () => {
      const { result, rerender } = renderHook(({ a }) => useFaseEspera(a), { initialProps: { a: true } });
      act(() => void vi.advanceTimersByTime(150)); // skeleton desde 100
      rerender({ a: false }); // terminou aos 150: 50 ms de skeleton
      expect(result.current.segurando).toBe(true);
      act(() => void vi.advanceTimersByTime(249));
      expect(result.current.segurando).toBe(true);
      act(() => void vi.advanceTimersByTime(1));
      expect(result.current.segurando).toBe(false);
      expect(result.current.fase).toBe("oculta");
    });

    it("skeleton que já passou de 300 ms some na hora", () => {
      const { result, rerender } = renderHook(({ a }) => useFaseEspera(a), { initialProps: { a: true } });
      act(() => void vi.advanceTimersByTime(600));
      rerender({ a: false });
      expect(result.current.segurando).toBe(false);
    });
  });

  describe("<Espera>", () => {
    it("nada visível antes de 100 ms, mas a forma reserva o layout", () => {
      render(<Tela carregando />);
      const f = screen.getByTestId("forma");
      expect(f.closest("[data-espera]")).toHaveAttribute("data-espera", "oculta");
      expect(f.parentElement).toHaveClass("opacity-0");
      expect(screen.queryByText("Juntando conversas…")).toBeNull();
      expect(screen.queryByTestId("conteudo")).toBeNull();
    });

    it("carga de 50 ms não pisca: conteúdo direto, skeleton nunca visível", () => {
      const { rerender } = render(<Tela carregando />);
      act(() => void vi.advanceTimersByTime(50));
      rerender(<Tela carregando={false} />);
      expect(screen.getByTestId("conteudo")).toBeInTheDocument();
      expect(screen.queryByTestId("forma")).toBeNull();
      act(() => void vi.advanceTimersByTime(1000));
      expect(screen.queryByTestId("forma")).toBeNull();
    });

    it("skeleton aos 100 ms; frase aos 1000 ms numa região aria-live polite", () => {
      render(<Tela carregando />);
      act(() => void vi.advanceTimersByTime(100));
      expect(screen.getByTestId("forma").parentElement).toHaveClass("opacity-100");
      expect(screen.queryByText("Juntando conversas…")).toBeNull();
      act(() => void vi.advanceTimersByTime(900));
      const frase = screen.getByText("Juntando conversas…");
      expect(frase.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
    });

    it("região viva existe desde o início (leitor de tela anuncia a frase quando entra)", () => {
      const { container } = render(<Tela carregando />);
      expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
      expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    });

    it("skeleton mínimo de 300 ms: dado que chega cedo espera o skeleton cumprir o tempo", () => {
      const { rerender } = render(<Tela carregando />);
      act(() => void vi.advanceTimersByTime(120)); // skeleton desde 100
      rerender(<Tela carregando={false} />);
      expect(screen.getByTestId("forma")).toBeInTheDocument();
      expect(screen.queryByTestId("conteudo")).toBeNull();
      act(() => void vi.advanceTimersByTime(280));
      expect(screen.getByTestId("conteudo")).toBeInTheDocument();
      expect(screen.queryByTestId("forma")).toBeNull();
    });

    it("semântica acessível: grupo ocupado com nome só pelo rótulo; frase anunciada uma vez", () => {
      const { container, rerender } = render(<Tela carregando />);
      const grupo = container.querySelector("[data-espera]")!;
      expect(grupo).toHaveAttribute("role", "group");
      expect(grupo).toHaveAttribute("aria-busy", "true");
      // Sem rótulo, o grupo não usa a frase como nome (seria lida 2×).
      expect(grupo).not.toHaveAttribute("aria-label");
      act(() => void vi.advanceTimersByTime(1000));
      expect(screen.getAllByText("Juntando conversas…")).toHaveLength(1);
      expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
      rerender(
        <Espera carregando forma={forma} frase="Juntando conversas…" rotulo="Carregando conversas">
          {conteudo}
        </Espera>,
      );
      expect(screen.getByRole("group", { name: "Carregando conversas" })).toHaveAttribute("data-espera");
    });

    it("frase é texto fixo da tela — nunca dado do usuário", () => {
      render(
        <Espera carregando forma={forma} frase="Abrindo a ficha…" rotulo="Carregando ficha do lead">
          {conteudo}
        </Espera>,
      );
      expect(screen.getByLabelText("Carregando ficha do lead")).toBeInTheDocument();
    });
  });
});
