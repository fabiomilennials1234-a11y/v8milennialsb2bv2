/**
 * ValueCombobox — combobox creatable de valor (UTM, campo personalizado).
 *
 * Cobre: seleção de item da lista → onChange(valor exato); digitar valor
 * inexistente → opção creatable → onChange(texto cru); estados loading/vazio.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Polyfills mínimos p/ Radix Popover + cmdk rodarem no jsdom.
beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.scrollIntoView = vi.fn();
  proto.hasPointerCapture = vi.fn(() => false);
  proto.setPointerCapture = vi.fn();
  proto.releasePointerCapture = vi.fn();
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

import { ValueCombobox } from "@/modules/workflows/components/sidebar-panels/ValueCombobox";

describe("ValueCombobox", () => {
  it("selecionar item da lista chama onChange com o valor exato", () => {
    const onChange = vi.fn();
    render(
      <ValueCombobox values={["meta_camp", "google_camp"]} value="" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("google_camp"));
    expect(onChange).toHaveBeenCalledWith("google_camp");
  });

  it("digitar valor inexistente oferece creatable e envia o texto cru", () => {
    const onChange = vi.fn();
    render(<ValueCombobox values={["meta_camp"]} value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));
    const raw = "[TESTE CRIATIVOS] BATERIA.";
    fireEvent.change(screen.getByPlaceholderText(/buscar ou digitar/i), {
      target: { value: raw },
    });
    fireEvent.click(screen.getByText(`Usar "${raw}"`));
    expect(onChange).toHaveBeenCalledWith(raw);
  });

  it("não oferece creatable quando o texto bate exatamente com um item", () => {
    render(<ValueCombobox values={["meta_camp"]} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.change(screen.getByPlaceholderText(/buscar ou digitar/i), {
      target: { value: "meta_camp" },
    });
    expect(screen.queryByText(/^Usar "/)).not.toBeInTheDocument();
  });

  it("estado vazio orienta a digitar manualmente (não bloqueia)", () => {
    render(<ValueCombobox values={[]} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByText(/digite manualmente/i)).toBeInTheDocument();
  });

  it("estado loading mostra 'Carregando valores…'", () => {
    render(<ValueCombobox values={[]} value="" onChange={vi.fn()} isLoading />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByText(/carregando valores/i)).toBeInTheDocument();
  });
});
