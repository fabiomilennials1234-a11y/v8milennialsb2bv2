/**
 * Tabs — a pílula que rola precisa avisar que rola.
 *
 * Com a barra de rolagem escondida, a última aba cortada pela borda parecia
 * defeito ("Compor…" no editor do Copilot). A lista em pílula marca as bordas
 * que escondem aba (`data-fade-start`/`data-fade-end`, lidas pelo CSS) e traz a
 * aba ativa para dentro quando ela muda. O jsdom não faz layout, então as
 * medidas são postas à mão — o que se testa é a regra, não o pixel.
 */
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Tabs, TabsList, TabsTrigger } from "./tabs";

function medir(el: HTMLElement, m: { scrollWidth: number; clientWidth: number }) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: m.scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: m.clientWidth });
}

function Abas({ variant }: { variant?: "pill" | "underline" }) {
  return (
    <Tabs defaultValue="a">
      <TabsList variant={variant} aria-label="Seções">
        <TabsTrigger value="a">Prompt</TabsTrigger>
        <TabsTrigger value="b">Comportamento</TabsTrigger>
        <TabsTrigger value="c">Notificação</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

describe("TabsList variant=pill — affordance de rolagem", () => {
  it("lista que cabe não esmaece borda nenhuma", () => {
    render(<Abas variant="pill" />);
    const lista = screen.getByRole("tablist", { name: "Seções" });
    expect(lista.dataset.fadeStart).toBe("false");
    expect(lista.dataset.fadeEnd).toBe("false");
  });

  it("no início de uma lista que não cabe, esmaece só o fim; rolada até o fim, só o começo", () => {
    render(<Abas variant="pill" />);
    const lista = screen.getByRole("tablist", { name: "Seções" });
    medir(lista, { scrollWidth: 600, clientWidth: 300 });

    lista.scrollLeft = 0;
    fireEvent.scroll(lista);
    expect(lista.dataset.fadeStart).toBe("false");
    expect(lista.dataset.fadeEnd).toBe("true");

    lista.scrollLeft = 300;
    fireEvent.scroll(lista);
    expect(lista.dataset.fadeStart).toBe("true");
    expect(lista.dataset.fadeEnd).toBe("false");
  });

  it("no meio, esmaece as duas bordas", () => {
    render(<Abas variant="pill" />);
    const lista = screen.getByRole("tablist", { name: "Seções" });
    medir(lista, { scrollWidth: 600, clientWidth: 300 });
    lista.scrollLeft = 150;
    fireEvent.scroll(lista);
    expect(lista.dataset.fadeStart).toBe("true");
    expect(lista.dataset.fadeEnd).toBe("true");
  });

  it("aba ativa fora da vista é trazida para dentro quando muda", async () => {
    const user = userEvent.setup();
    render(<Abas variant="pill" />);
    const lista = screen.getByRole("tablist", { name: "Seções" });
    medir(lista, { scrollWidth: 600, clientWidth: 300 });
    const ultima = screen.getByRole("tab", { name: "Notificação" });
    Object.defineProperty(ultima, "offsetLeft", { configurable: true, value: 480 });
    Object.defineProperty(ultima, "offsetWidth", { configurable: true, value: 110 });

    await user.click(ultima);

    // Borda direita da aba (590) + respiro de 24 − largura visível (300).
    expect(lista.scrollLeft).toBe(314);
  });

  it("a variante sublinhada não ganha o comportamento", () => {
    render(<Abas variant="underline" />);
    const lista = screen.getByRole("tablist", { name: "Seções" });
    expect(lista.dataset.fadeStart).toBeUndefined();
    expect(lista.dataset.fadeEnd).toBeUndefined();
  });
});
