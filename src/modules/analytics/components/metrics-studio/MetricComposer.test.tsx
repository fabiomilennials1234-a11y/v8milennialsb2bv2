import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MetricComposer } from "./MetricComposer";
import type { MetricCustomDefinition } from "../../hooks/useMetricCustomDefinitions";

vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ timezone: "UTC" }) }));
vi.mock("@/modules/pipelines", () => ({
  useFunisDaOrg: () => ({ data: [] }), useEtapasDoFunil: () => ({ etapas: [], isLoading: false }),
  isPipelineVisible: () => true, sortPipelinesForNavigation: (items: unknown[]) => items,
}));
vi.mock("@/modules/analytics/hooks/useStudioClock", () => ({ useStudioClock: () => new Date("2026-10-02T12:00:00Z") }));
vi.mock("@/modules/analytics/hooks/useMetricMeasure", () => ({ useMetricMeasure: () => ({ data: { value: 12 }, isLoading: false }) }));
vi.mock("@/shared/errors", () => ({ notifyError: vi.fn() }));

describe("métricas da base atual no compositor", () => {
  it.each([
    ["base_leads_atuais", "Leads — base atual"],
    ["base_clientes_atuais", "Clientes — base atual"],
  ])("permite editar e salvar %s sem substituir sua medida", async (id, label) => {
    const definition: MetricCustomDefinition = {
      id: "definition", organization_id: "org", name: label, description: null,
      tree: { type: "measure", id }, format_id: "integer", derived_unit: "count",
      created_at: "2026-10-02", updated_at: "2026-10-02",
    };
    const save = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    render(<MetricComposer aberto period="month" editando={definition} salvando={false} onFechar={close} onSalvar={save} />);

    expect(screen.getByRole("combobox", { name: "Métrica" })).toHaveTextContent(label);
    expect(screen.queryByText(/não está no catálogo/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: `${label} revisada` } });
    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith({
      name: `${label} revisada`, tree: definition.tree, format_id: "integer",
    }));
    expect(close).toHaveBeenCalledOnce();
  });
});
