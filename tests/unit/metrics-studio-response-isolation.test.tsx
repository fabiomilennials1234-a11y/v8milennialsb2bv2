import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const backend = vi.hoisted(() => ({ rpc: vi.fn(), responseFails: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: backend.rpc } }));
vi.mock("@/modules/identity", () => ({
  useIdentity: () => ({ isAdmin: false }),
  useOrganization: () => ({ organizationId: "insana", timezone: "America/Sao_Paulo", isReady: true }),
  useCurrentTeamMember: () => ({ data: { id: "member", organization_id: "insana", role: "member" } }),
}));
vi.mock("@/modules/engagement", () => ({ useTeamGoals: () => ({ data: [] }), useFollowUps: () => ({ data: [] }) }));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/shared/hooks/useCountUp", () => ({ useCountUp: (value: number) => value }));
vi.mock("@/modules/analytics/hooks/useFunnelHealth", () => ({ useFunnelHealth: () => ({ data: undefined }) }));
vi.mock("@/modules/analytics/components/dashboard/v2/OraculoBriefing", () => ({ OraculoBriefing: () => null }));
vi.mock("@/modules/analytics/components/dashboard/v2/LiveOpsFeed", () => ({ LiveOpsFeed: () => null }));
import { IndicadoresCard } from "@/modules/analytics/components/metrics-studio/dashboard-card-adapters";
import { studioInterval } from "@/modules/analytics/lib/metrics-studio-interval";

beforeEach(() => {
  backend.responseFails = false;
  backend.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === "get_dashboard_metrics") return { error: null, data: { totalLeads: 8, novosClientes: 2, ticketMedio: 1200 } };
    if (name === "fn_metric_measure") return backend.responseFails
      ? { data: null, error: { code: "57014", message: "statement timeout" } }
      : { data: { value: 2949, unit: "duration_seconds", empty_reason: null }, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
});

describe("card real da Visão Geral com consultas independentes", () => {
  it.each([false, true])("mantém KPIs da organização e indica a disponibilidade da resposta (falha: %s)", async (responseFails) => {
    backend.responseFails = responseFails;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const range = studioInterval("month", new Date("2026-09-15T13:00:00Z"), "America/Sao_Paulo");
    const { unmount } = render(<QueryClientProvider client={queryClient}><MemoryRouter>
      <IndicadoresCard period="month" month={9} year={2026} range={range} monthlyRange={range} />
    </MemoryRouter></QueryClientProvider>);
    const leads = await screen.findByRole("button", { name: /Leads novos/ });
    expect(within(leads).getByText("8")).toBeVisible();
    const response = await screen.findByRole("button", { name: /Resposta da equipe/ });
    if (responseFails) {
      expect(await within(response).findByText("Resposta temporariamente indisponível")).toBeVisible();
      expect(within(response).getByText("—")).toBeVisible();
    } else {
      expect(await within(response).findByText("49min")).toBeVisible();
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // O adaptador compartilhado não aplica o filtro pessoal do membro.
    expect(backend.rpc).toHaveBeenCalledWith("get_dashboard_metrics", expect.objectContaining({ p_org_id: "insana", p_filter_member_id: undefined }));
    unmount();
    queryClient.clear();
  });
});
