/**
 * Comando — aquecimento das dependências do card "Conversas aguardando"
 * (régua de espera, CP-v2). Sem RPC nova e sem banco: as caixas são pedidas
 * pelo Dashboard junto da identidade, e a RPC da fila sai na primeira
 * renderização do card com as caixas já em cache.
 */
import type { ReactNode } from "react";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  instancias: vi.fn((_o?: { enabled?: boolean }) => ({ data: undefined, isLoading: true })),
  trackModuleVisit: vi.fn(),
  org: { organizationId: "org-1", orgType: "inbound" as string, isLoading: true },
  papel: { role: "admin" },
}));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => h.org,
  useUserRole: () => ({ data: h.papel }),
  useCurrentTeamMember: () => ({ isLoading: false, data: { organization_id: "org-1", id: "member-1", role: "admin" } }),
  useIdentity: () => ({ isAdmin: true, teamMemberId: "member-1" }),
  isVirtualTeamMember: () => false,
}));
vi.mock("@/modules/communication", () => ({ useWhatsAppInstancesForUser: h.instancias }));
vi.mock("@/lib/analytics", () => ({ trackModuleVisit: h.trackModuleVisit }));
vi.mock("@/modules/analytics/components/dashboard/v2/TabProximosPassos", () => ({
  TabProximosPassos: () => <div data-testid="proximos-passos" />,
}));
vi.mock("@/modules/leads", () => ({ LeadModal: () => null }));
vi.mock("@/contexts/OrgFeaturesContext", () => ({ useOrgFeatures: () => ({ hasFeature: () => false }) }));
vi.mock("@/modules/analytics/pages/DashboardOutbound", () => ({ default: () => <div data-testid="outbound" /> }));

import Dashboard from "@/modules/analytics/pages/Dashboard";

const montar = () => render(<MemoryRouter><TooltipProvider><Dashboard /></TooltipProvider></MemoryRouter>);

beforeEach(() => {
  h.instancias.mockClear();
  h.trackModuleVisit.mockClear();
  h.org = { organizationId: "org-1", orgType: "inbound", isLoading: true };
  h.papel = { role: "admin" };
});

describe("Dashboard (Comando) — aquecimento", () => {
  it("pede as caixas já no skeleton, antes de o card montar", () => {
    montar();
    expect(screen.queryByTestId("proximos-passos")).toBeNull();
    expect(h.instancias).toHaveBeenCalledWith({ enabled: true });
  });

  it("registra a visita ao módulo comando", () => {
    h.org = { ...h.org, isLoading: false };
    montar();
    expect(h.trackModuleVisit).toHaveBeenCalledWith("comando", "org-1");
    expect(screen.getByTestId("proximos-passos")).toBeInTheDocument();
  });

  it("membro outbound não paga a ida das caixas (a tela dele não tem o card)", () => {
    h.org = { organizationId: "org-1", orgType: "outbound", isLoading: false };
    h.papel = { role: "member" };
    montar();
    expect(screen.getByTestId("outbound")).toBeInTheDocument();
    expect(h.instancias).toHaveBeenCalledWith({ enabled: false });
  });
});

describe("useConversasAguardando — fila numa ida", () => {
  it("sai na primeira renderização, sem esperar nem repetir a ida das caixas", async () => {
    vi.resetModules();
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const from = vi.fn();
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: { rpc, from } }));
    vi.doMock("@/modules/communication", async () => ({
      useWhatsAppInstancesForUser: (await import("@/modules/communication/hooks/chat/useWhatsAppInstances")).useWhatsAppInstancesForUser,
    }));
    vi.doMock("@/modules/analytics/hooks/useComandoScope", () => ({
      useComandoScope: () => ({ escopo: "tudo", isAdmin: true, meuTeamMemberId: "member-1", meuUserId: "u", isReady: true }),
    }));
    const { useConversasAguardando } = await import("@/modules/analytics/hooks/useConversasAguardando");

    // Mesmo staleTime do QueryClient do app (App.tsx): 5 min.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } } });
    qc.setQueryData(["whatsapp_instances_for_user", "org-1", "member-1", "admin"], [{ id: "chip-1", instance_name: "Comercial" }]);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

    renderHook(() => useConversasAguardando(10), { wrapper });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    // get_comando_fila resolve as caixas no servidor: nenhum p_instances no payload.
    expect(rpc).toHaveBeenCalledWith("get_comando_fila", { p_org: "org-1", p_limit: 30 });
    expect(from).not.toHaveBeenCalled();
    qc.clear();
  });
});
