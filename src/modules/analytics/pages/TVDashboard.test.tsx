import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TVDashboard from "./TVDashboard";

const state = vi.hoisted(() => ({
  goals: [{ type: "faturamento", target_value: 280000 }],
  goalsLoading: false,
  goalsError: false,
  metricsLoading: false,
  metricsError: false,
  useTeamGoals: vi.fn(),
  useCommandMetrics: vi.fn(),
  refetchGoals: vi.fn(),
  refetchMetrics: vi.fn(),
  refetchTV: vi.fn(),
}));

vi.mock("@/modules/analytics/hooks/useTVDashboardData", () => ({
  // Riofix has a company goal, but this signed-in member has no personal goal.
  useTVDashboardData: () => ({ data: { metaVendasMes: 0, vendasRealizadas: 0 }, isLoading: false, refetch: state.refetchTV }),
}));
vi.mock("@/modules/engagement/hooks/useGoals", () => ({
  useTeamGoals: (...args: unknown[]) => {
    state.useTeamGoals(...args);
    return { data: state.goals, isPending: state.goalsLoading, isError: state.goalsError, refetch: state.refetchGoals };
  },
}));
vi.mock("@/modules/analytics/hooks/useCommandMetrics", () => ({
  useCommandMetrics: (...args: unknown[]) => {
    state.useCommandMetrics(...args);
    return { data: { vendaTotal: 12200 }, isPending: state.metricsLoading, isError: state.metricsError, refetch: state.refetchMetrics };
  },
}));
vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ timezone: "America/Sao_Paulo", isReady: true }) }));
vi.mock("@/modules/analytics/hooks/useTVKPIs", () => ({ useTVKPIs: () => ({}) }));
vi.mock("@/modules/analytics/hooks/useDashboardMetrics", () => ({ useRankingData: () => ({ data: undefined }) }));
vi.mock("@/modules/identity/hooks/useAvatarMap", () => ({ useAvatarMap: () => new Map() }));
vi.mock("@/modules/platform/hooks/useOnboarding", () => ({ useOnboarding: () => ({ onboarding: undefined }) }));
vi.mock("@/modules/analytics/hooks/useComposableDashboard", () => ({ useComposableMetricsEnabled: () => ({ data: false }) }));
vi.mock("@/modules/analytics/components/tv/composable/TVComposableShell", () => ({ TVComposableShell: () => null }));
vi.mock("@/modules/engagement/hooks/useCompetitions", () => ({
  useActiveCompetition: () => null,
  useCompetitionParticipants: () => ({ data: [] }),
  useCompetitionPrizes: () => ({ data: [] }),
}));
vi.mock("@/modules/analytics/components/tv/AICoachSection", () => ({ AICoachSection: () => null }));
vi.mock("@/modules/analytics/components/tv/SalesFunnel", () => ({ SalesFunnel: () => null }));
vi.mock("@/modules/analytics/components/tv/TVCompetitionBlockV2", () => ({ TVCompetitionBlockV2: () => null }));
vi.mock("@/modules/analytics/components/tv/SDRPerformanceBlock", () => ({ SDRPerformanceBlock: () => null }));
vi.mock("@/modules/analytics/components/tv/CloserPerformanceBlock", () => ({ CloserPerformanceBlock: () => null }));
vi.mock("@/modules/analytics/components/tv/NewLeadsBlock", () => ({ NewLeadsBlock: () => null }));
vi.mock("@/modules/analytics/components/tv/TVRankingSimple", () => ({ TVRankingSimple: () => null }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 2, 12));
  vi.clearAllMocks();
  state.goals = [{ type: "faturamento", target_value: 280000 }];
  state.goalsLoading = state.goalsError = state.metricsLoading = state.metricsError = false;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("TV monthly company goal", () => {
  it("shows the configured R$ 280k goal and company revenue even without a personal goal", () => {
    render(<TVDashboard />);
    expect(screen.getByText("R$ 280.0K")).toBeInTheDocument();
    expect(screen.queryByText("R$ 60.0K")).not.toBeInTheDocument();
    expect(screen.getByText("R$ 12.2K")).toBeInTheDocument();
    expect(screen.getByText("4%")).toBeInTheDocument();
    expect(state.useTeamGoals).toHaveBeenCalledWith(10, 2026);
    expect(state.useCommandMetrics).toHaveBeenCalledWith(expect.objectContaining({ start: expect.any(Date), end: expect.any(Date) }), null);
  });

  it.each(["goalsLoading", "metricsLoading"] as const)("waits for %s without displaying a made-up target", (field) => {
    state[field] = true;
    render(<TVDashboard />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando meta do mês");
    expect(screen.queryByText("R$ 60.0K")).not.toBeInTheDocument();
    expect(screen.queryByText("4%")).not.toBeInTheDocument();
  });

  it.each(["goalsError", "metricsError"] as const)("reports %s and retries both monthly sources", (field) => {
    state[field] = true;
    render(<TVDashboard />);
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar a meta do mês");
    expect(screen.queryByText("4%")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(state.refetchGoals).toHaveBeenCalledOnce();
    expect(state.refetchMetrics).toHaveBeenCalledOnce();
  });

  it.each([
    { goals: [] },
    { goals: [{ type: "faturamento", target_value: 0 }] },
    { goals: [{ type: "clientes", target_value: 280000 }] },
  ])("shows an empty state without a revenue goal ($goals)", ({ goals }) => {
    state.goals = goals;
    render(<TVDashboard />);
    expect(screen.getByText("Meta de faturamento não configurada para este mês.")).toBeInTheDocument();
    expect(screen.queryByText("R$ 60.0K")).not.toBeInTheDocument();
  });

  it("reflects goal edits and manually refreshes the monthly sources", () => {
    const { rerender } = render(<TVDashboard />);
    state.goals = [{ type: "faturamento", target_value: 300000 }];
    rerender(<TVDashboard />);
    expect(screen.getByText("R$ 300.0K")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar dashboard" }));
    expect(state.refetchTV).toHaveBeenCalledOnce();
    expect(state.refetchGoals).toHaveBeenCalledOnce();
    expect(state.refetchMetrics).toHaveBeenCalledOnce();
  });

  it("keeps the monthly scope during period rotation and uses the organization timezone", async () => {
    vi.setSystemTime(new Date("2026-11-01T01:00:00Z")); // Still October in Riofix.
    render(<TVDashboard />);
    expect(state.useTeamGoals).toHaveBeenLastCalledWith(10, 2026);
    expect(state.useCommandMetrics).toHaveBeenLastCalledWith(expect.objectContaining({
      start: new Date("2026-10-01T03:00:00Z"),
      end: new Date("2026-11-01T02:59:59.999Z"),
    }), null);
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    expect(screen.getByText("META DE OUTUBRO")).toBeInTheDocument();
    expect(screen.getByText("R$ 280.0K")).toBeInTheDocument();
    vi.setSystemTime(new Date("2026-11-01T03:01:00Z"));
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(state.useTeamGoals).toHaveBeenLastCalledWith(11, 2026);
    expect(screen.getByText("META DE NOVEMBRO")).toBeInTheDocument();
  });
});
