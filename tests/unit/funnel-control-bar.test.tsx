/**
 * `FunnelControlBar` — a faixa única do Modelo 1.
 *
 * Fecha `inv:H2-01` e `inv:H2-03`. O cabeçalho antigo empilhava CINCO fileiras
 * antes do board aparecer; em 1366px isso comia quase metade da altura útil e
 * o trabalho começava abaixo da dobra. A faixa existe para caber em uma linha.
 *
 * O que se prova aqui é o contrato que sustenta essa economia:
 *
 *   1. **chips só ocupam espaço quando existem** — eles são estado ativo, não
 *      controle. Quem não filtrou não paga a fileira. Uma regressão que
 *      renderize o contêiner vazio devolve a fileira que o redesenho tirou;
 *   2. **os controles entram por slot**, não prop-a-prop. Cada funil traz o
 *      seu painel de filtros e o seu menu de visões; a faixa é layout, não
 *      orquestrador. Slot ausente não pode virar buraco nem quebrar;
 *   3. a busca é um campo só, rotulado, que emite o que foi digitado.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// O switcher tem suíte própria (funnel-nav-switcher.test.tsx) e arrasta
// react-router + os hooks de funil. Aqui ele é um slot como os outros.
vi.mock("@/modules/pipelines/components/shared/FunnelSwitcher", () => ({
  FunnelSwitcher: ({ fallbackLabel }: { fallbackLabel: string }) => (
    <button data-testid="switcher">{fallbackLabel}</button>
  ),
}));

import { FunnelControlBar } from "@/modules/pipelines/components/shared/FunnelControlBar";

function montar(props: Partial<React.ComponentProps<typeof FunnelControlBar>> = {}) {
  const onSearchChange = props.onSearchChange ?? vi.fn();
  render(
    <FunnelControlBar
      funnelKey="sys:whatsapp"
      funnelLabel="Qualificação"
      search=""
      onSearchChange={onSearchChange}
      {...props}
    />,
  );
  return onSearchChange;
}

describe("FunnelControlBar — a fileira que só aparece quando há o que mostrar", () => {
  it("sem chips, nada é renderizado abaixo da faixa", () => {
    montar();

    const barra = screen.getByTestId("funnel-control-bar");
    // Um único filho: a linha de controles. O segundo filho só existe com chips.
    expect(barra.children).toHaveLength(1);
  });

  it("com chips, eles vêm abaixo da linha de controles", () => {
    montar({ chips: <div data-testid="chips">Origem: Meta</div> });

    const barra = screen.getByTestId("funnel-control-bar");
    expect(barra.children).toHaveLength(2);
    expect(screen.getByTestId("chips")).toBeInTheDocument();
    // E depois da linha de controles, não antes.
    expect(barra.lastElementChild).toContainElement(screen.getByTestId("chips"));
  });
});

describe("FunnelControlBar — os controles entram por slot", () => {
  it("renderiza todos os slots quando a página os fornece", () => {
    montar({
      views: <button data-testid="views">Views</button>,
      filters: <button data-testid="filters">Filtros</button>,
      actions: <button data-testid="actions">Período</button>,
      primaryAction: <button data-testid="primary">Novo negócio</button>,
    });

    for (const id of ["switcher", "views", "filters", "actions", "primary"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("página sem slots não quebra nem deixa a faixa vazia", () => {
    montar();

    expect(screen.getByTestId("switcher")).toBeInTheDocument();
    expect(screen.getByTestId("funnel-search")).toBeInTheDocument();
    expect(screen.queryByTestId("views")).toBeNull();
  });

  it("a ordem é: funil, busca, e depois os slots da página", () => {
    montar({
      views: <button data-testid="views">Views</button>,
      primaryAction: <button data-testid="primary">Novo negócio</button>,
    });

    const linha = screen.getByTestId("funnel-control-bar").firstElementChild!;
    const ordem = Array.from(linha.querySelectorAll("[data-testid]")).map((e) =>
      e.getAttribute("data-testid"),
    );

    expect(ordem.indexOf("switcher")).toBeLessThan(ordem.indexOf("funnel-search"));
    expect(ordem.indexOf("funnel-search")).toBeLessThan(ordem.indexOf("views"));
    expect(ordem.indexOf("views")).toBeLessThan(ordem.indexOf("primary"));
  });
});

describe("FunnelControlBar — busca", () => {
  it("emite o que foi digitado", () => {
    const onSearchChange = montar();

    fireEvent.change(screen.getByTestId("funnel-search"), { target: { value: "distética" } });

    expect(onSearchChange).toHaveBeenCalledWith("distética");
  });

  it("mostra o valor controlado pela página", () => {
    montar({ search: "meta ads" });

    expect(screen.getByTestId("funnel-search")).toHaveValue("meta ads");
  });

  it("tem rótulo acessível mesmo sem label visível", () => {
    montar();

    expect(screen.getByLabelText("Buscar no funil")).toBeInTheDocument();
  });

  it("aceita placeholder próprio da página, com um padrão sensato", () => {
    const { unmount } = render(
      <FunnelControlBar
        funnelKey="sys:whatsapp"
        funnelLabel="Qualificação"
        search=""
        onSearchChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("funnel-search")).toHaveAttribute(
      "placeholder",
      "Buscar lead, empresa, telefone…",
    );
    unmount();

    montar({ searchPlaceholder: "Buscar negócio…" });
    expect(screen.getByTestId("funnel-search")).toHaveAttribute("placeholder", "Buscar negócio…");
  });
});
