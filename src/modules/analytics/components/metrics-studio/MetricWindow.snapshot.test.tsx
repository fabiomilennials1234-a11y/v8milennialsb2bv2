import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MetricWindow } from "./MetricWindow";
import { ENGINE_BY_ID, type EngineMetric } from "../../lib/metrics-studio-engine-map";
import { comoEngineMetric } from "../../hooks/useStudioCatalog";
import type { MetricTreeNode } from "../../lib/metric-tree";

const { measure } = vi.hoisted(() => ({ measure: vi.fn() }));
vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ timezone: "UTC" }) }));
vi.mock("@/modules/analytics/hooks/useStudioClock", () => ({ useStudioClock: () => new Date("2026-10-02T12:00:00Z") }));
vi.mock("@/modules/analytics/hooks/useMetricMeasure", () => ({ useMetricMeasure: measure }));

function custom(tree: MetricTreeNode): EngineMetric {
  return comoEngineMetric({
    id: "definition", organization_id: "org", name: "Minha métrica", description: null,
    tree, format_id: "integer", derived_unit: "count", created_at: "2026-10-02", updated_at: "2026-10-02",
  });
}

function show(metric: EngineMetric) {
  render(<MetricWindow
    win={{ id: "window", metricId: metric.id, corte: "total", chart: "number", x: 0, y: 0, w: 320, h: 220, z: 1 }}
    metric={metric} period="month" podeVerPorPessoa editavel={false} selected={false}
    canvas={{ width: 1000, height: 800 }} onSelect={vi.fn()} onMove={vi.fn()} onResize={vi.fn()}
    onChart={vi.fn()} onCorte={vi.fn()} onRemove={vi.fn()}
  />);
}

beforeEach(() => {
  measure.mockReset();
  // Mesmo a consulta desabilitada devolve cache: isso não autoriza comparativo.
  measure.mockImplementation(({ ref }: { ref: string }) => ({
    data: { value: ref === "2026-10-02" ? 20 : 10, series: null, target: null },
    isLoading: false, isError: false, refetch: vi.fn(),
  }));
});

describe("comparação de períodos das métricas de base atual", () => {
  it.each([
    ENGINE_BY_ID.get("base_leads_atuais")!,
    ENGINE_BY_ID.get("base_clientes_atuais")!,
    custom({ type: "measure", id: "base_leads_atuais" }),
    custom({ type: "op", op: "add", left: { type: "measure", id: "base_clientes_atuais" }, right: { type: "literal", value: 1 } }),
    custom({ type: "op", op: "div", left: { type: "measure", id: "receita" }, right: { type: "measure", id: "base_clientes_atuais" } }),
  ])("omite histórico falso em $id", (metric) => {
    show(metric);
    expect(screen.getByText("20")).toBeVisible();
    expect(screen.queryByTitle("Comparado ao período anterior")).not.toBeInTheDocument();
    expect(measure).toHaveBeenCalledWith(expect.objectContaining({ ref: "2026-09-02", enabled: false }));
  });

  it.each([
    ENGINE_BY_ID.get("receita")!,
    custom({ type: "measure", id: "leads_criados" }),
  ])("mantém consulta e comparação histórica em $id", (metric) => {
    show(metric);
    expect(screen.getByTitle("Comparado ao período anterior")).toHaveTextContent("100.0%");
    expect(measure).toHaveBeenCalledWith(expect.objectContaining({ ref: "2026-09-02", enabled: true }));
  });
});
