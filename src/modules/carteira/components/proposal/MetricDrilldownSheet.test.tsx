import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MetricDrilldownSheet } from "./MetricDrilldownSheet";
import type { DrilldownRow } from "@/modules/carteira/hooks/useMetricDrilldown";
import React from "react";

const MOCK_ROWS: DrilldownRow[] = [
  {
    id: "p1", lead_id: "l1", sale_value: 3000, status: "vendido",
    product_type: "mrr", closed_at: "2026-05-10T00:00:00Z",
    created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-10T00:00:00Z",
    lead: { name: "Acme Corp Lead", company: "Acme Corp" },
    responsible: { name: "João" },
  },
  {
    id: "p2", lead_id: "l2", sale_value: 5000, status: "proposta_enviada",
    product_type: null, closed_at: null,
    created_at: "2026-05-03T00:00:00Z", updated_at: "2026-05-03T00:00:00Z",
    lead: { name: "Beta Industries", company: "Beta Inc" },
    responsible: { name: "Maria" },
  },
];

const onClose = vi.fn();
const onSelectItem = vi.fn();

function renderSheet(props?: Partial<React.ComponentProps<typeof MetricDrilldownSheet>>) {
  return render(
    <MetricDrilldownSheet
      isOpen={true}
      onClose={onClose}
      onSelectItem={onSelectItem}
      metricType="vendas_total"
      displayValue="R$ 8.000"
      displayCount={2}
      periodLabel="maio/2026"
      data={MOCK_ROWS}
      isLoading={false}
      {...props}
    />
  );
}

beforeEach(() => {
  onClose.mockReset();
  onSelectItem.mockReset();
});

describe("MetricDrilldownSheet", () => {
  it("renders header with title, value, count, and period", () => {
    renderSheet();
    expect(screen.getByText("Vendas Total")).toBeInTheDocument();
    expect(screen.getByText("R$ 8.000")).toBeInTheDocument();
    expect(screen.getByText(/2 propostas.*maio\/2026/)).toBeInTheDocument();
  });

  it("renders all rows with lead name and value", () => {
    renderSheet();
    expect(screen.getByText("Acme Corp Lead")).toBeInTheDocument();
    expect(screen.getByText("Beta Industries")).toBeInTheDocument();
  });

  it("filters rows by search term on lead name", async () => {
    renderSheet();
    const input = screen.getByPlaceholderText(/buscar/i);
    fireEvent.change(input, { target: { value: "Acme" } });
    await waitFor(() => {
      expect(screen.getByText("Acme Corp Lead")).toBeInTheDocument();
      expect(screen.queryByText("Beta Industries")).not.toBeInTheDocument();
    });
  });

  it("filters rows by search term on company name", async () => {
    renderSheet();
    const input = screen.getByPlaceholderText(/buscar/i);
    fireEvent.change(input, { target: { value: "Beta Inc" } });
    await waitFor(() => {
      expect(screen.queryByText("Acme Corp Lead")).not.toBeInTheDocument();
      expect(screen.getByText("Beta Industries")).toBeInTheDocument();
    });
  });

  it("calls onSelectItem with lead_id when row is clicked", () => {
    renderSheet();
    fireEvent.click(screen.getByText("Acme Corp Lead"));
    expect(onSelectItem).toHaveBeenCalledWith("l1");
  });

  it("shows correct title for each metric type", () => {
    const { rerender } = render(
      <MetricDrilldownSheet isOpen onClose={onClose} onSelectItem={onSelectItem}
        metricType="pipeline_ativo" displayValue="R$ 10.000" displayCount={5}
        periodLabel="Geral" data={[]} isLoading={false} />
    );
    expect(screen.getByText("Pipeline Ativo")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    renderSheet({ isLoading: true, data: [] });
    expect(screen.getByText(/carregando/i)).toBeInTheDocument();
  });

  it("shows empty state when no data", () => {
    renderSheet({ data: [] });
    expect(screen.getByText(/nenhuma proposta/i)).toBeInTheDocument();
  });
});
