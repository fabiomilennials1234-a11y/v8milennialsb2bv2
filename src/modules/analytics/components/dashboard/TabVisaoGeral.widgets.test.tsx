import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabVisaoGeral } from "./TabVisaoGeral";
const state = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/modules/platform", () => ({ useFeatureFlag: (key: string) => ({ enabled: key === "dashboard_draggable_widgets" && state.enabled }) }));
vi.mock("@/modules/identity", () => ({ useAuth: () => ({ user: { id: "user-a" } }), useOrganization: () => ({ organizationId: "org-a" }) }));
vi.mock("@/modules/analytics/hooks/useDashboardMetrics", () => ({ useDashboardMetrics: () => ({ data: {}, isLoading: false }) }));
vi.mock("@/modules/engagement/hooks/useGoals", () => ({ useTeamGoals: () => ({ data: [] }) }));
vi.mock("./MetricsWidgetGrid", () => ({ MetricsWidgetGrid: () => <div>Widget piloto</div> }));
vi.mock("./KPICard", () => ({ KPICard: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock("./TopPerformers", () => ({ TopPerformers: () => null }));
vi.mock("./FunnelChart", () => ({ FunnelChart: () => null }));
vi.mock("./FirstOrderVsBase", () => ({ FirstOrderVsBase: () => null }));
vi.mock("./SpeedometerGauge", () => ({ SpeedometerGauge: () => null }));
afterEach(cleanup);
describe("rollout dos widgets", () => {
  it("preserva os indicadores atuais sem flag", () => {
    state.enabled = false;
    render(<TabVisaoGeral month={9} year={2026} isAdmin />);
    expect(screen.queryByText("Widget piloto")).not.toBeInTheDocument();
    expect(screen.getByText("Receita do Mês")).toBeInTheDocument();
  });
  it("renderiza o piloto somente com flag e volta ao legado após trocar de org", () => {
    state.enabled = true;
    const { rerender } = render(<TabVisaoGeral month={9} year={2026} isAdmin />);
    expect(screen.getByText("Widget piloto")).toBeInTheDocument();
    state.enabled = false;
    rerender(<TabVisaoGeral month={10} year={2026} isAdmin />);
    expect(screen.queryByText("Widget piloto")).not.toBeInTheDocument();
    expect(screen.getByText("Receita do Mês")).toBeInTheDocument();
  });
});
