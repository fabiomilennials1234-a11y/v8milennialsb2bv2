/** Coluna do Funil pela régua: osso com a forma do card, frase só numa coluna. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { FunilColunaSkeleton } from "@/modules/pipelines/components/funis/FunilColunaSkeleton";

describe("FunilColunaSkeleton", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("nada antes de 100 ms; cards em osso depois; frase aos 1 s", () => {
    render(<FunilColunaSkeleton carregando frase="Trazendo os negócios de cada etapa…" />);
    expect(screen.queryAllByTestId("card-em-osso")).toHaveLength(0);
    act(() => void vi.advanceTimersByTime(100));
    expect(screen.getAllByTestId("card-em-osso")).toHaveLength(3);
    expect(screen.queryByText(/Trazendo/)).toBeNull();
    act(() => void vi.advanceTimersByTime(900));
    expect(screen.getByText(/Trazendo/).closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  });

  it("coluna sem frase fica calada", () => {
    const { container } = render(<FunilColunaSkeleton carregando />);
    act(() => void vi.advanceTimersByTime(1500));
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("carga rápida (50 ms) não pisca; osso visível cumpre 300 ms", () => {
    const { rerender } = render(<FunilColunaSkeleton carregando />);
    act(() => void vi.advanceTimersByTime(50));
    rerender(<FunilColunaSkeleton carregando={false} />);
    expect(screen.queryByTestId("funil-coluna-skeleton")).toBeNull();

    rerender(<FunilColunaSkeleton carregando />);
    act(() => void vi.advanceTimersByTime(120));
    rerender(<FunilColunaSkeleton carregando={false} />);
    expect(screen.getAllByTestId("card-em-osso")).toHaveLength(3);
    act(() => void vi.advanceTimersByTime(280));
    expect(screen.queryByTestId("funil-coluna-skeleton")).toBeNull();
  });
});
