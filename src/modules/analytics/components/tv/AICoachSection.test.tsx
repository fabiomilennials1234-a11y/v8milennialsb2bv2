import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AICoachSection } from "./AICoachSection";

const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  identity: { isReady: true, organizationId: "org-a", userId: "user-a" },
  features: { isReady: true, hasFeature: vi.fn(() => true) },
  tvData: { metaVendasMes: 100, vendasRealizadas: 20 },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: state.invoke } } }));
vi.mock("@/modules/identity", () => ({ useIdentity: () => state.identity, useTeamMembers: () => ({ data: [] }) }));
vi.mock("@/contexts/OrgFeaturesContext", () => ({ useOrgFeatures: () => state.features }));
vi.mock("@/modules/analytics/hooks/useTVDashboardData", () => ({ useTVDashboardData: () => ({ data: state.tvData }) }));
vi.mock("@/modules/engagement/hooks/useGoals", () => ({ useIndividualGoals: () => ({ data: {} }) }));

const response = (diagnostico = "Análise A") => ({ data: { diagnostico, vendor_actions: [] }, error: null });
let client: QueryClient;
function mount() {
  return render(<QueryClientProvider client={client}><AICoachSection /></QueryClientProvider>);
}
async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  state.identity = { isReady: true, organizationId: "org-a", userId: "user-a" };
  state.features.isReady = true;
  state.features.hasFeature.mockReturnValue(true);
  state.tvData = { metaVendasMes: 100, vendasRealizadas: 20 };
  state.invoke.mockReset().mockResolvedValue(response());
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); focusManager.setFocused(undefined); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("TV coach invocation budget", () => {
  it("reuses analysis across rotations and metric changes; refresh uses latest inputs after five minutes", async () => {
    let view = mount();
    await settle();
    expect(screen.getByText("Análise A")).toBeTruthy();
    for (let rotation = 0; rotation < 25; rotation++) {
      view.unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      state.tvData = { metaVendasMes: 200 + rotation, vendasRealizadas: 25 };
      view = mount();
      await settle();
    }
    expect(state.invoke).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(50_001); });
    await settle();
    expect(state.invoke).toHaveBeenCalledTimes(2);
    expect(state.invoke.mock.calls[1]).toEqual(["oraculo-comercial", { body: {
      mode: "tv_analysis", organization_id: "org-a",
      tv_data: { metaVendasMes: 224, vendasRealizadas: 25, ondeDeveriamEstar: 0, propostasQuentes: [] },
      team_members: [],
    } }]);
  });

  it.each(["identity", "features", "denied"])("does not invoke with unresolved or denied access: %s", async (gate) => {
    if (gate === "identity") state.identity.isReady = false;
    if (gate === "features") state.features.isReady = false;
    if (gate === "denied") state.features.hasFeature.mockReturnValue(false);
    mount();
    await settle();
    expect(state.invoke).not.toHaveBeenCalled();
  });

  it("isolates cached results by organization and user and hides them when access is revoked", async () => {
    let view = mount();
    await settle();
    view.unmount();
    state.identity.organizationId = "org-b";
    state.invoke.mockResolvedValue(response("Análise B"));
    view = mount();
    expect(screen.queryByText("Análise A")).toBeNull();
    await settle();
    expect(screen.getByText("Análise B")).toBeTruthy();
    view.unmount();
    state.identity.userId = "user-b";
    state.invoke.mockResolvedValue(response("Análise C"));
    view = mount();
    expect(screen.queryByText("Análise B")).toBeNull();
    await settle();
    expect(state.invoke).toHaveBeenCalledTimes(3);
    state.features.hasFeature.mockReturnValue(false);
    view.rerender(<QueryClientProvider client={client}><AICoachSection /></QueryClientProvider>);
    expect(screen.queryByText("Análise C")).toBeNull();
  });

  it("cools down errors across rotations but permits explicit retry", async () => {
    state.invoke.mockResolvedValue({ data: null, error: new Error("Plano indisponível") });
    let view = mount();
    await settle();
    for (let i = 0; i < 5; i++) { view.unmount(); view = mount(); await settle(); }
    expect(state.invoke).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Plano indisponível")).toBeTruthy();
    state.invoke.mockResolvedValue(response());
    fireEvent.click(screen.getByText("Tentar novamente"));
    await settle();
    expect(state.invoke).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Análise A")).toBeTruthy();
  });

  it("does not invoke or create a tight polling timer while the tab is hidden", async () => {
    client.setQueryData(["tv-coach-analysis", "org-a", "user-a"],
      { analysis: response().data, error: null }, { updatedAt: Date.now() - 299_500 });
    focusManager.setFocused(false);
    const intervals = vi.spyOn(window, "setInterval");
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(state.invoke).not.toHaveBeenCalled();
    expect(intervals.mock.calls.every((call) => Number(call[1]) >= 1_000)).toBe(true);
    focusManager.setFocused(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await settle();
    expect(state.invoke).toHaveBeenCalledTimes(1);
  });

  it("shares an in-flight request across remounts and long requests", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    state.invoke.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = mount();
    await settle();
    view.unmount();
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
    expect(state.invoke).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(response()); });
    await settle();
    expect(screen.getByText("Análise A")).toBeTruthy();
  });
});
