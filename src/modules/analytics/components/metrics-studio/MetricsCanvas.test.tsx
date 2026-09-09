import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { MetricsCanvas } from "./MetricsCanvas";
import { studioInterval } from "../../lib/metrics-studio-interval";

vi.mock("./MetricWindow", () => ({ MetricWindow: () => <div>Card disponível</div> }));
vi.mock("./FixedWindow", () => ({ FixedWindow: () => <div>Card fixo</div> }));

describe("canvas — catálogo indisponível não faz os cards desaparecerem", () => {
  it("preserva o espaço salvo e volta a desenhar quando o catálogo retorna", () => {
    const interval = studioInterval("month", new Date("2026-09-08T12:00:00Z"), "UTC");
    const props: ComponentProps<typeof MetricsCanvas> = {
      windows: [{ id: "w", metricId: "leads_criados", corte: "total", chart: "number", x: 16, y: 16, w: 320, h: 200, z: 1 }],
      byId: new Map(), intervalo: interval, monthlyRange: interval,
      month: 9, year: 2026, period: "month", podeVerPorPessoa: true, editavel: false, podeEditar: true,
      selectedId: null, size: { width: 1200, height: 800 }, onEditar: vi.fn(), onSelect: vi.fn(), onMove: vi.fn(),
      onResize: vi.fn(), onChart: vi.fn(), onCorte: vi.fn(), onRemove: vi.fn(),
    };
    const { rerender } = render(<MetricsCanvas {...props} />);
    expect(screen.getByRole("group", { name: "Métrica indisponível" })).toBeVisible();
    expect(screen.queryByText("Painel em branco")).toBeNull();
    rerender(<MetricsCanvas {...props} byId={new Map([["leads_criados", {
      id: "leads_criados", label: "Leads", measureRef: { kind: "leaf", id: "leads_criados" }, cortes: ["total"], formatId: "integer",
    }]])} />);
    expect(screen.getByText("Card disponível")).toBeVisible();
    expect(props.onRemove).not.toHaveBeenCalled();
    expect(props.windows).toHaveLength(1);
  });
});
