import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// O dublê fica na fronteira (a RPC), não no módulo de billing: assim o teste
// exercita a chave, as opções compartilhadas e o mapeamento de verdade.
const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: { user: { id: "u1" } as { id: string } | null, loading: false },
  master: { isMaster: false, isLoading: false },
  teamMember: {
    data: { id: "tm-1", user_id: "u1", organization_id: "org-A", role: "member" } as Record<string, unknown> | null,
    isLoading: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  role: { data: { role: "member" } as { role: string } | undefined, isLoading: false },
  copilot: { canManage: false, isLoading: false },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc } }));
// `user` NOVO a cada render, de propósito: é o cenário que transformava o
// efeito antigo num laço contra a RPC.
vi.mock("../auth/contexts/AuthContext", () => ({
  useAuth: () => ({ user: h.auth.user ? { ...h.auth.user } : null, loading: h.auth.loading }),
}));
vi.mock("../master/hooks/useMasterAuth", () => ({ useMasterAuth: () => h.master }));
vi.mock("../org-team/hooks/useCurrentTeamMember", () => ({ useCurrentTeamMember: () => h.teamMember }));
vi.mock("../permissions/hooks/useUserRole", () => ({
  useUserRole: () => h.role,
  useCanManageCopilot: () => h.copilot,
}));
// Barril de identity, só para o `useCopilotSubscription` do caso de dedupe.
vi.mock("@/modules/identity", () => ({
  useCanManageCopilot: () => h.copilot,
  useCurrentTeamMember: () => h.teamMember,
}));
vi.mock("@/modules/billing/components/subscription/OverdueBanner", () => ({
  OverdueBanner: ({ graceRemaining }: { graceRemaining: number }) => <p>banner atraso {graceRemaining}</p>,
}));
vi.mock("@/modules/billing/components/subscription/SubscriptionBlockedPage", () => ({
  SubscriptionBlockedPage: () => <p>assinatura bloqueada</p>,
}));

import { SubscriptionProtectedRoute } from "./SubscriptionProtectedRoute";
import { useCopilotSubscription } from "@/modules/copilot/hooks/useCopilotSubscription";

const ativa = {
  status: "active",
  plan: "torque-v8",
  expires_at: null,
  is_valid: true,
  days_remaining: null,
  grace_remaining: null,
  is_overdue: false,
  is_blocked: false,
};

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

function renderGuard(requireActive = false, extra?: ReactNode) {
  const client = new QueryClient();
  const W = wrapper(client);
  return render(
    <W>
      <SubscriptionProtectedRoute requireActive={requireActive}>
        <p>conteúdo protegido</p>
      </SubscriptionProtectedRoute>
      {extra}
    </W>,
  );
}

function Guard({ requireActive = false }: { requireActive?: boolean }) {
  return (
    <SubscriptionProtectedRoute requireActive={requireActive}>
      <p>conteúdo protegido</p>
    </SubscriptionProtectedRoute>
  );
}

function CopilotProbe() {
  const { isLoading } = useCopilotSubscription();
  return <span>{isLoading ? "copilot carregando" : "copilot pronto"}</span>;
}

beforeEach(() => {
  h.auth = { user: { id: "u1" }, loading: false };
  h.master = { isMaster: false, isLoading: false };
  h.teamMember = {
    data: { id: "tm-1", user_id: "u1", organization_id: "org-A", role: "member" },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  };
  h.role = { data: { role: "member" }, isLoading: false };
  h.copilot = { canManage: false, isLoading: false };
});
afterEach(() => h.rpc.mockReset());

describe("SubscriptionProtectedRoute", () => {
  it("falha ao verificar não vira 'assinatura bloqueada' nem 404 — e não libera acesso", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "timeout", code: "57014", details: null, hint: null } });
    renderGuard();

    expect(await screen.findByText("Não conseguimos confirmar sua assinatura")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tentar de novo/i })).toBeInTheDocument();
    expect(screen.queryByText("assinatura bloqueada")).not.toBeInTheDocument();
    expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
  });

  it("tentar de novo refaz a verificação", async () => {
    h.rpc.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue({ data: ativa, error: null });
    renderGuard();

    (await screen.findByRole("button", { name: /tentar de novo/i })).click();
    await waitFor(() => expect(screen.getByText("conteúdo protegido")).toBeInTheDocument());
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });

  it("trial em área que pede assinatura ativa mostra a razão — não um 404", async () => {
    h.rpc.mockResolvedValue({ data: { ...ativa, status: "trial" }, error: null });
    renderGuard(true);

    expect(await screen.findByText("Disponível com a assinatura ativa")).toBeInTheDocument();
    expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
  });

  it("assinatura ativa libera", async () => {
    h.rpc.mockResolvedValue({ data: ativa, error: null });
    renderGuard();
    expect(await screen.findByText("conteúdo protegido")).toBeInTheDocument();
  });

  it("não martela a verificação quando o objeto user muda de identidade", async () => {
    h.rpc.mockResolvedValue({ data: ativa, error: null });
    renderGuard();
    await screen.findByText("conteúdo protegido");
    await new Promise((r) => setTimeout(r, 100));
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  // ─── Perf boot (21/11) ────────────────────────────────────────────────────

  it("dispara a RPC com a org assim que o vínculo existe — sem esperar papel nem copilot", async () => {
    h.role = { data: undefined, isLoading: true };
    h.copilot = { canManage: false, isLoading: true };
    h.rpc.mockResolvedValue({ data: ativa, error: null });
    renderGuard();

    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("org_get_subscription_status", { p_org_id: "org-A" }));
    // Fora de requireActive, papel/copilot não mudam a decisão: não seguram a tela.
    expect(await screen.findByText("conteúdo protegido")).toBeInTheDocument();
  });

  it("multi-org: checa a org do vínculo ATUAL, não a primeira que o banco devolver", async () => {
    h.teamMember = { ...h.teamMember, data: { id: "tm-2", user_id: "u1", organization_id: "org-B", role: "member" } };
    h.rpc.mockResolvedValue({ data: ativa, error: null });
    renderGuard();

    await screen.findByText("conteúdo protegido");
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("org_get_subscription_status", { p_org_id: "org-B" });
  });

  it.each(["suspended", "cancelled", "expired"])("assinatura %s → tela de bloqueio, sem o conteúdo", async (status) => {
    h.rpc.mockResolvedValue({ data: { ...ativa, status, is_valid: false, is_blocked: true }, error: null });
    renderGuard();

    expect(await screen.findByText("assinatura bloqueada")).toBeInTheDocument();
    expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
  });

  it("enquanto a RPC não volta, só o loader — nunca o conteúdo", async () => {
    h.rpc.mockReturnValue(new Promise(() => {}));
    renderGuard();

    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
    expect(screen.getByAltText("Torque")).toBeInTheDocument();
    expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
  });

  it("vínculo resolvido sem org → mesma tela de falha de hoje, sem RPC", async () => {
    h.teamMember = { ...h.teamMember, data: null };
    renderGuard();

    expect(await screen.findByText("Não conseguimos confirmar sua assinatura")).toBeInTheDocument();
    expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("falha ao carregar o vínculo fecha o acesso com a tela honesta", async () => {
    h.teamMember = { ...h.teamMember, data: null, error: new Error("Network failure") };
    renderGuard();

    expect(await screen.findByText("Não conseguimos confirmar sua assinatura")).toBeInTheDocument();
    expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
  });

  it("sem sessão → /auth, sem RPC", async () => {
    h.auth = { user: null, loading: false };
    h.teamMember = { ...h.teamMember, data: null };
    renderGuard();

    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("master mantém o bypass: libera sem consultar a assinatura", async () => {
    h.master = { isMaster: true, isLoading: false };
    renderGuard();

    expect(await screen.findByText("conteúdo protegido")).toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("master ainda resolvendo: loader, nada de conteúdo nem RPC", () => {
    h.master = { isMaster: false, isLoading: true };
    renderGuard();

    expect(screen.getByAltText("Torque")).toBeInTheDocument();
    expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("trial + requireActive com papel ainda carregando: espera, não libera nem tranca antes da hora", async () => {
    h.role = { data: undefined, isLoading: true };
    h.copilot = { canManage: false, isLoading: true };
    h.rpc.mockResolvedValue({ data: { ...ativa, status: "trial" }, error: null });
    renderGuard(true);

    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByAltText("Torque")).toBeInTheDocument();
    expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
    expect(screen.queryByText("Disponível com a assinatura ativa")).not.toBeInTheDocument();
  });

  it("trial + requireActive: admin (bypass) libera quando o papel resolve", async () => {
    h.role = { data: { role: "admin" }, isLoading: false };
    h.rpc.mockResolvedValue({ data: { ...ativa, status: "trial" }, error: null });
    renderGuard(true);

    expect(await screen.findByText("conteúdo protegido")).toBeInTheDocument();
  });

  it("guard + Copilot montados juntos: UMA RPC (chave compartilhada)", async () => {
    h.rpc.mockResolvedValue({ data: ativa, error: null });
    renderGuard(false, <CopilotProbe />);

    await screen.findByText("conteúdo protegido");
    await screen.findByText("copilot pronto");
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("overdue: libera o conteúdo COM o banner de atraso", async () => {
    h.rpc.mockResolvedValue({
      data: { ...ativa, status: "overdue", is_overdue: true, grace_remaining: 4 },
      error: null,
    });
    renderGuard();

    expect(await screen.findByText("conteúdo protegido")).toBeInTheDocument();
    expect(screen.getByText("banner atraso 4")).toBeInTheDocument();
  });

  it("troca de org: chave nova → loader, nunca o status da org antiga", async () => {
    h.rpc.mockImplementation((_fn: string, args: { p_org_id: string }) =>
      args.p_org_id === "org-A"
        ? Promise.resolve({ data: ativa, error: null })
        : new Promise(() => {}),
    );
    const client = new QueryClient();
    const W = wrapper(client);
    const { rerender } = render(<W><Guard /></W>);
    expect(await screen.findByText("conteúdo protegido")).toBeInTheDocument();

    // org switcher: o vínculo atual passa a ser a org-B (RPC dela não volta).
    h.teamMember = { ...h.teamMember, data: { id: "tm-2", user_id: "u1", organization_id: "org-B", role: "member" } };
    rerender(<W><Guard /></W>);

    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("org_get_subscription_status", { p_org_id: "org-B" }));
    expect(screen.getByAltText("Torque")).toBeInTheDocument();
    expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
  });

  it("troca de org para uma org bloqueada: bloqueia, sem reaproveitar a liberação da anterior", async () => {
    h.rpc.mockImplementation((_fn: string, args: { p_org_id: string }) =>
      Promise.resolve({
        data: args.p_org_id === "org-A" ? ativa : { ...ativa, status: "suspended", is_valid: false, is_blocked: true },
        error: null,
      }),
    );
    const client = new QueryClient();
    const W = wrapper(client);
    const { rerender } = render(<W><Guard /></W>);
    expect(await screen.findByText("conteúdo protegido")).toBeInTheDocument();

    h.teamMember = { ...h.teamMember, data: { id: "tm-2", user_id: "u1", organization_id: "org-B", role: "member" } };
    rerender(<W><Guard /></W>);

    expect(await screen.findByText("assinatura bloqueada")).toBeInTheDocument();
    expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
  });
});
