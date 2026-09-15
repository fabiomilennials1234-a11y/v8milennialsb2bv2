import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { KpiCardCompact } from "@/modules/analytics/components/dashboard/v2/KpiCardCompact";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), org: "org-insana" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/modules/identity", () => ({
  useIdentity: () => ({ isAdmin: true }),
  useOrganization: () => ({ organizationId: mocks.org, timezone: "America/Sao_Paulo", isReady: true }),
  useCurrentTeamMember: () => ({ data: { id: "admin", organization_id: mocks.org } }),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
import { useCommandMetrics } from "@/modules/analytics/hooks/useCommandMetrics";
import { useTeamResponseTime } from "@/modules/analytics/hooks/useTeamResponseTime";

const range = { start: new Date("2026-09-01T03:00:00Z"), end: new Date("2026-10-01T02:59:59.999Z") };
function Wrapper({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  mocks.org = "org-insana";
  mocks.rpc.mockReset().mockImplementation(async (name: string) => ({ data: name === "get_dashboard_metrics"
    ? { totalLeads: 8, tempoMedioResposta: 0.0007546285416666666 }
    : { value: 2949, unit: "duration_seconds", empty_reason: null }, error: null }));
});
describe("indicadores com as fontes da organização selecionada", () => {
  it("mantém leads e receita disponíveis quando somente a consulta de resposta falha", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "get_dashboard_metrics"
      ? { data: { totalLeads: 8, vendaTotal: 1200 }, error: null }
      : { data: null, error: { code: "57014", message: "statement timeout" } });
    const { result } = renderHook(() => useCommandMetrics(range), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.totalLeads).toBe(8);
    expect(result.current.data?.vendaTotal).toBe(1200);
  });
  it("não espera mensagens para carregar os indicadores financeiros", async () => {
    mocks.rpc.mockImplementation((name: string) => name === "get_dashboard_metrics"
      ? Promise.resolve({ data: { vendaTotal: 1200 }, error: null })
      : new Promise(() => {}));
    const { result } = renderHook(() => useCommandMetrics(range), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data?.vendaTotal).toBe(1200));
  });
  it("usa o tempo de resposta das mensagens e converte segundos em minutos", async () => {
    const { result } = renderHook(() => useTeamResponseTime(range), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(49.15);
    expect(mocks.rpc).toHaveBeenCalledWith("fn_metric_measure", expect.objectContaining({
      p_org_id: "org-insana", p_start: "2026-09-01", p_end: "2026-09-30",
      p_measure_ref: { kind: "leaf", id: "tempo_resposta_equipe" },
    }));
  });
  it("não transforma ausência da função de métricas em indicadores zerados", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "function missing" } });
    const { result } = renderHook(() => useCommandMetrics(range), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
  it.each([null, 0])("preserva a diferença entre ausência e zero no tempo de resposta (%s)", async (value) => {
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "get_dashboard_metrics"
      ? { totalLeads: 8 } : { value, unit: "duration_seconds", empty_reason: value === null ? "no_rows" : null } }));
    const { result } = renderHook(() => useTeamResponseTime(range), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(value);
  });
  it("distingue medida indisponível de ausência de respostas", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "function missing" } });
    const { result } = renderHook(() => useTeamResponseTime(range), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
  it("mostra ausência como traço no card, sem sugerir resposta imediata", () => {
    render(<MemoryRouter><KpiCardCompact label="Resposta da equipe" value={null} format="minutes"
      caption="Sem respostas medidas no período" quickActionLabel="Abrir conversas" quickActionTo="/chat-whatsapp" /></MemoryRouter>);
    expect(screen.getByText("—")).toBeVisible();
    expect(screen.queryByText(/^0\s?min$/)).not.toBeInTheDocument();
  });
});
