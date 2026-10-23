import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClosedOutcomeStack } from "./ClosedOutcomeStack";
import {
  partitionClosedOutcomes,
  type ClosedMonthSummary,
} from "@/modules/pipelines/lib/closed-outcome-groups";

interface Item {
  id: string;
  amount: number;
}

const items: Item[] = [
  { id: "a", amount: 1063.92 },
  { id: "b", amount: 14928.48 },
];

function buildWonGroup() {
  const { closed } = partitionClosedOutcomes(items, {
    outcomeOf: () => "won",
    closedAtOf: () => "2026-10-15T15:00:00Z",
    amountOf: (item) => item.amount,
  });
  return closed[0];
}

function renderStack(expanded: boolean) {
  return render(
    <ClosedOutcomeStack<Item>
      group={buildWonGroup()}
      expanded={expanded}
      openMonths={new Set<string>()}
      onToggleExpanded={vi.fn()}
      onToggleMonth={vi.fn()}
      onOpenAllMonths={vi.fn()}
      renderItem={(item) => <div key={item.id}>{item.id}</div>}
    />,
  );
}

describe("ClosedOutcomeStack — total com centavos", () => {
  it("mostra o total do mês com centavos quando expandido", () => {
    renderStack(true);
    expect(screen.getByTestId("closed-month-total").textContent).toMatch(/R\$\s15\.992,40/);
  });

  it("mostra o total do baralho fechado com centavos", () => {
    renderStack(false);
    expect(screen.getByTestId("closed-stack-won").textContent).toMatch(/R\$\s15\.992,40/);
  });
});

/**
 * Chamado 172ef046 — Café Jurerê, Envase, coluna Vendido: a 1ª página trouxe
 * 20 ganhos (1 de agosto, 8 de setembro, 11 de outubro); a etapa tem 104.
 */
describe("ClosedOutcomeStack — pilha da etapa inteira (Chamado 172ef046)", () => {
  interface Won {
    id: string;
    closedAt: string;
    amount: number;
  }

  // Meio-dia UTC no meio do mês: cai no mesmo mês em qualquer fuso de teste.
  const loaded: Won[] = [
    { id: "ago-0", closedAt: "2026-08-15T12:00:00Z", amount: 1000 },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `set-${i}`, closedAt: `2026-09-1${i}T12:00:00Z`, amount: 500 })),
    ...Array.from({ length: 11 }, (_, i) => ({ id: `out-${i}`, closedAt: `2026-10-${10 + i}T12:00:00Z`, amount: 100 })),
  ];

  const resumo: ClosedMonthSummary[] = [
    { outcome: "won", monthKey: "2026-08", count: 10, total: 25123.48 },
    { outcome: "won", monthKey: "2026-09", count: 69, total: 411501.3 },
    { outcome: "won", monthKey: "2026-10", count: 25, total: 91084.14 },
  ];

  function wonGroup(summary?: ClosedMonthSummary[]) {
    return partitionClosedOutcomes(
      loaded,
      { outcomeOf: () => "won", closedAtOf: (c) => c.closedAt, amountOf: (c) => c.amount },
      summary,
    ).closed[0];
  }

  function renderGroup(
    group: ReturnType<typeof wonGroup>,
    opts: { expanded: boolean; hasMore: boolean; openMonths?: string[]; onLoadMore?: () => void },
  ) {
    return render(
      <ClosedOutcomeStack<Won>
        group={group}
        expanded={opts.expanded}
        hasMore={opts.hasMore}
        onLoadMore={opts.onLoadMore}
        openMonths={new Set(opts.openMonths ?? [])}
        onToggleExpanded={vi.fn()}
        onToggleMonth={vi.fn()}
        onOpenAllMonths={vi.fn()}
        renderItem={(item) => <div key={item.id}>{item.id}</div>}
      />,
    );
  }

  it("K2 — com o resumo, o baralho diz 104 e o valor da etapa, sem '+' nem '≥', mesmo com a coluna paginando", () => {
    renderGroup(wonGroup(resumo), { expanded: false, hasMore: true });
    const deck = screen.getByTestId("closed-stack-won");
    expect(deck.textContent).toMatch(/^104ganhos/);
    expect(deck.textContent).toMatch(/R\$\s527\.708,92/);
    expect(deck.textContent).not.toMatch(/\+|≥/);
    expect(deck.getAttribute("aria-label")).toBe("104 negócios ganhos — abrir lista");
  });

  it("K2 — com o resumo, setembro mostra 69 e R$ 411.501,30", () => {
    renderGroup(wonGroup(resumo), { expanded: true, hasMore: true });
    const setembro = screen.getByTestId("closed-month-won-2026-09");
    expect(setembro.textContent).toMatch(/Setembro de 2026\s*69(?!\+)/);
    expect(setembro.textContent).toMatch(/R\$\s411\.501,30/);
    expect(setembro.textContent).not.toMatch(/≥/);
  });

  it("K2 — sem resumo e com página por vir, o mês diz '8+' e os valores dizem '≥'", () => {
    renderGroup(wonGroup(), { expanded: true, hasMore: true });
    const setembro = screen.getByTestId("closed-month-won-2026-09");
    expect(setembro.textContent).toMatch(/8\+/);
    expect(setembro.textContent).toMatch(/≥\s*R\$\s4\.000,00/);
    cleanup();

    renderGroup(wonGroup(), { expanded: false, hasMore: true });
    const deck = screen.getByTestId("closed-stack-won");
    expect(deck.textContent).toMatch(/^20\+/);
    // 1×1.000 + 8×500 + 11×100 — só o carregado, e por isso "≥".
    expect(deck.textContent).toMatch(/≥\s*R\$\s6\.100,00/);
  });

  it("sem resumo e sem página por vir, o carregado é o total: nada de '+' nem '≥'", () => {
    renderGroup(wonGroup(), { expanded: true, hasMore: false });
    const setembro = screen.getByTestId("closed-month-won-2026-09");
    expect(setembro.textContent).not.toMatch(/\+|≥/);
  });

  it("mês aberto com menos cards que a contagem oferece 'Carregar mais na coluna'", () => {
    const onLoadMore = vi.fn();
    renderGroup(wonGroup(resumo), { expanded: true, hasMore: true, openMonths: ["2026-09"], onLoadMore });
    fireEvent.click(screen.getByRole("button", { name: /Carregar mais na coluna/ }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
