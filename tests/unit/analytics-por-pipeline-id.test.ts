/**
 * SCRUM-631 (W3 · Funil é Funil) — Analytics por pipeline_id.
 *
 * Prova que:
 * 1. useAnalyticsPipelineOptions lista os funis reais/ativos da org e resolve
 *    os defaults documentados (funil padrão da org / funil de fechamento);
 * 2. useFunnelConversion / usePipelineVelocity / useSalesCycleAnalysis /
 *    useAnalyticsPipesFunis endereçam as RPCs por p_pipeline_id (+ p_org_id),
 *    nunca mais pelo slug legado;
 * 3. PipelineSelector renderiza "Todos" + os funis reais, com pipeline_id
 *    como valor.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

// ── Mocks ───────────────────────────────────────────────────────────────────
const mockRpc = vi.fn().mockResolvedValue({ data: [], error: null });
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: vi.fn(),
  },
}));

const mockUsePipelines = vi.fn();
// O hook lê por `useFunisDaOrg` — os funis da org já com `label`, o nome que
// ela usa. `usePipelines` segue mockado porque outros imports do barril o usam.
vi.mock("@/modules/pipelines", () => ({
  useFunisDaOrg: () => mockUsePipelines(),
  usePipelines: () => mockUsePipelines(),
}));

const mockSettings = vi.fn();
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-test", isReady: true }),
  useOrganizationSettings: () => ({ settings: mockSettings() }),
}));

vi.mock("@/modules/analytics/hooks/useAnalyticsFilters", () => ({
  useAnalyticsFilters: () => ({
    filters: { memberId: null },
    startStr: "2026-06-01",
    endStr: "2026-09-01",
  }),
}));

import { useAnalyticsPipelineOptions } from "@/modules/analytics/hooks/useAnalyticsPipelineOptions";
import {
  useFunnelConversion,
  usePipelineVelocity,
  useSalesCycleAnalysis,
} from "@/modules/analytics/hooks/useAnalytics";
import { useAnalyticsPipesFunis } from "@/modules/analytics/hooks/useAnalyticsPipesFunis";
import { PipelineSelector } from "@/modules/analytics/components/analytics/charts/PipelineSelector";

const FUNIS = [
  // `name` = seed congelado do banco; `label` = nome que a ORG usa. Diferentes
  // de propósito nos de sistema: é o que prova que a tela mostra o da org.
  { id: "id-whats", name: "Qualificação", label: "Oportunidades", slug: "whatsapp", is_active: true },
  { id: "id-prop", name: "Propostas", label: "Orçamentos", slug: "propostas", is_active: true },
  { id: "id-cus", name: "Carteira Sul", label: "Carteira Sul", slug: "carteira-sul", is_active: true },
  { id: "id-off", name: "Desativado", label: "Desativado", slug: "morto", is_active: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: [], error: null });
  mockUsePipelines.mockReturnValue({ data: FUNIS, isLoading: false });
  mockSettings.mockReturnValue({ default_pipeline_id: "id-whats" });
});

// ── useAnalyticsPipelineOptions ─────────────────────────────────────────────
describe("useAnalyticsPipelineOptions", () => {
  it("lista só funis ativos, com id/name/slug", () => {
    const { result } = renderHook(() => useAnalyticsPipelineOptions(), {
      wrapper: createWrapper(),
    });
    expect(result.current.options.map((o) => o.id)).toEqual(["id-whats", "id-prop", "id-cus"]);
    expect(result.current.options[2]).toEqual({ id: "id-cus", name: "Carteira Sul", slug: "carteira-sul" });
  });

  it("orgDefault = funil padrão da org (SCRUM-624) quando ativo", () => {
    const { result } = renderHook(() => useAnalyticsPipelineOptions(), {
      wrapper: createWrapper(),
    });
    expect(result.current.orgDefault).toBe("id-whats");
  });

  it("orgDefault cai para o primeiro funil quando o padrão da org não existe/está inativo", () => {
    mockSettings.mockReturnValue({ default_pipeline_id: "id-off" });
    const { result } = renderHook(() => useAnalyticsPipelineOptions(), {
      wrapper: createWrapper(),
    });
    expect(result.current.orgDefault).toBe("id-whats");
  });

  it("closingDefault prefere o funil de slug 'propostas' (default legado dos gráficos de venda)", () => {
    const { result } = renderHook(() => useAnalyticsPipelineOptions(), {
      wrapper: createWrapper(),
    });
    expect(result.current.closingDefault).toBe("id-prop");
  });

  it("closingDefault cai para orgDefault quando não há funil 'propostas'", () => {
    mockUsePipelines.mockReturnValue({
      data: FUNIS.filter((f) => f.slug !== "propostas"),
      isLoading: false,
    });
    const { result } = renderHook(() => useAnalyticsPipelineOptions(), {
      wrapper: createWrapper(),
    });
    expect(result.current.closingDefault).toBe("id-whats");
  });

  it("sem funil nenhum: defaults nulos e lista vazia", () => {
    mockUsePipelines.mockReturnValue({ data: [], isLoading: false });
    const { result } = renderHook(() => useAnalyticsPipelineOptions(), {
      wrapper: createWrapper(),
    });
    expect(result.current.options).toEqual([]);
    expect(result.current.orgDefault).toBeNull();
    expect(result.current.closingDefault).toBeNull();
  });
});

// ── Hooks de RPC: endereçam por pipeline_id ─────────────────────────────────
describe("useFunnelConversion", () => {
  it("chama get_funnel_conversion com p_pipeline_id + p_org_id (sem slug)", async () => {
    renderHook(() => useFunnelConversion("id-cus", "2026-06-01", "2026-09-01"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(mockRpc).toHaveBeenCalledWith("get_funnel_conversion", {
      p_org_id: "org-test",
      p_pipeline_id: "id-cus",
      p_start_date: "2026-06-01",
      p_end_date: "2026-09-01",
    });
    expect(mockRpc.mock.calls[0][1]).not.toHaveProperty("p_pipeline_type");
  });

  it("não dispara sem funil selecionado", async () => {
    renderHook(() => useFunnelConversion(null), { wrapper: createWrapper() });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("usePipelineVelocity", () => {
  it("chama get_pipeline_velocity com p_pipeline_id + p_org_id", async () => {
    mockRpc.mockResolvedValue({ data: { num_won: 1 }, error: null });
    renderHook(() => usePipelineVelocity("id-prop", "2026-06-01", "2026-09-01"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(mockRpc).toHaveBeenCalledWith("get_pipeline_velocity", {
      p_org_id: "org-test",
      p_pipeline_id: "id-prop",
      p_start_date: "2026-06-01",
      p_end_date: "2026-09-01",
    });
  });

  it("não dispara sem funil selecionado", async () => {
    renderHook(() => usePipelineVelocity(null), { wrapper: createWrapper() });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("useSalesCycleAnalysis", () => {
  it("filtra por p_pipeline_id quando um funil é passado", async () => {
    renderHook(() => useSalesCycleAnalysis("id-cus", "2026-06-01", "2026-09-01"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(mockRpc).toHaveBeenCalledWith("get_sales_cycle_analysis", {
      p_org_id: "org-test",
      p_pipeline_id: "id-cus",
      p_start_date: "2026-06-01",
      p_end_date: "2026-09-01",
    });
  });

  it("sem funil = jornada cross-funil (p_pipeline_id null) — contrato do LeadJourney", async () => {
    renderHook(() => useSalesCycleAnalysis(undefined, "2026-06-01", "2026-09-01"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(mockRpc.mock.calls[0][1].p_pipeline_id).toBeNull();
  });
});

describe("useAnalyticsPipesFunis", () => {
  it("passa p_pipeline_id (id de qualquer funil) e nunca p_pipeline_type", async () => {
    mockRpc.mockResolvedValue({ data: { pipeline_total: 0 }, error: null });
    renderHook(() => useAnalyticsPipesFunis("id-cus"), { wrapper: createWrapper() });
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    const [fn, args] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe("get_analytics_pipeline_metrics");
    expect(args.p_pipeline_id).toBe("id-cus");
    expect(args.p_org_id).toBe("org-test");
    expect(args).not.toHaveProperty("p_pipeline_type");
  });

  it('null = "Todos" (sem filtro de funil)', async () => {
    mockRpc.mockResolvedValue({ data: { pipeline_total: 0 }, error: null });
    renderHook(() => useAnalyticsPipesFunis(null), { wrapper: createWrapper() });
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect((mockRpc.mock.calls[0][1] as Record<string, unknown>).p_pipeline_id).toBeNull();
  });
});

// ── PipelineSelector ────────────────────────────────────────────────────────
describe("PipelineSelector", () => {
  it('renderiza "Todos" + os funis reais da org (custom incluído), sem os inativos', () => {
    const onChange = vi.fn();
    const Wrapper = createWrapper();
    render(
      React.createElement(Wrapper, null, React.createElement(PipelineSelector, { selected: null, onChange })),
    );
    expect(screen.getByText("Todos")).toBeTruthy();
    // O NOME QUE A ORG USA, não o seed do banco: o seletor mostrava
    // "Qualificação"/"Propostas" (`pipelines.name`, congelado por
    // `create_default_pipelines()`) para toda org, inclusive as que renomearam.
    expect(screen.getByText("Oportunidades")).toBeTruthy();
    expect(screen.getByText("Orçamentos")).toBeTruthy();
    expect(screen.queryByText("Qualificação")).toBeNull();
    expect(screen.queryByText("Propostas")).toBeNull();
    // Funil custom não muda: ali `pipelines.name` já é o nome do usuário.
    expect(screen.getByText("Carteira Sul")).toBeTruthy();
    expect(screen.queryByText("Desativado")).toBeNull();
  });

  it("clicar num funil devolve o pipeline_id; clicar em Todos devolve null", () => {
    const onChange = vi.fn();
    const Wrapper = createWrapper();
    render(
      React.createElement(Wrapper, null, React.createElement(PipelineSelector, { selected: "id-whats", onChange })),
    );
    fireEvent.click(screen.getByText("Carteira Sul"));
    expect(onChange).toHaveBeenCalledWith("id-cus");
    fireEvent.click(screen.getByText("Todos"));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
