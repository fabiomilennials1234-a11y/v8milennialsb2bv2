import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClosedOutcomeStack } from "./ClosedOutcomeStack";
import { partitionClosedOutcomes } from "@/modules/pipelines/lib/closed-outcome-groups";

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
