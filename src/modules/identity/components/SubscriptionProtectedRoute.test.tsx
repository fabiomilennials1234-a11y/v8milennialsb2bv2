import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { checkCurrentUserSubscription } = vi.hoisted(() => ({ checkCurrentUserSubscription: vi.fn() }));

vi.mock("@/modules/billing/lib/subscription", () => ({ checkCurrentUserSubscription }));
vi.mock("../auth/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("../auth/hooks/useIdentity", () => ({ useIdentity: () => ({ isMaster: false, isLoading: false }) }));
vi.mock("../permissions/hooks/useUserRole", () => ({
  useUserRole: () => ({ data: { role: "member" }, isLoading: false }),
  useCanManageCopilot: () => ({ canManage: false, isLoading: false }),
}));
vi.mock("@/modules/billing/components/subscription/OverdueBanner", () => ({ OverdueBanner: () => null }));
vi.mock("@/modules/billing/components/subscription/SubscriptionBlockedPage", () => ({
  SubscriptionBlockedPage: () => <p>assinatura bloqueada</p>,
}));

import { SubscriptionProtectedRoute } from "./SubscriptionProtectedRoute";

const ativa = {
  status: "active",
  plan: "torque-v8",
  expiresAt: null,
  isValid: true,
  daysRemaining: null,
  graceRemaining: null,
  isOverdue: false,
  isBlocked: false,
};

function renderGuard(requireActive = false) {
  return render(
    <MemoryRouter>
      <SubscriptionProtectedRoute requireActive={requireActive}>
        <p>conteúdo protegido</p>
      </SubscriptionProtectedRoute>
    </MemoryRouter>,
  );
}

describe("SubscriptionProtectedRoute", () => {
  afterEach(() => checkCurrentUserSubscription.mockReset());

  it("falha ao verificar não vira 'assinatura bloqueada' nem 404 — e não libera acesso", async () => {
    checkCurrentUserSubscription.mockRejectedValue({ message: "timeout", code: "57014", details: null, hint: null });
    renderGuard();

    expect(await screen.findByText("Não conseguimos confirmar sua assinatura")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tentar de novo/i })).toBeInTheDocument();
    expect(screen.queryByText("assinatura bloqueada")).not.toBeInTheDocument();
    expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
  });

  it("tentar de novo refaz a verificação", async () => {
    checkCurrentUserSubscription.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(ativa);
    renderGuard();

    (await screen.findByRole("button", { name: /tentar de novo/i })).click();
    await waitFor(() => expect(screen.getByText("conteúdo protegido")).toBeInTheDocument());
    expect(checkCurrentUserSubscription).toHaveBeenCalledTimes(2);
  });

  it("trial em área que pede assinatura ativa mostra a razão — não um 404", async () => {
    checkCurrentUserSubscription.mockResolvedValue({ ...ativa, status: "trial" });
    renderGuard(true);

    expect(await screen.findByText("Disponível com a assinatura ativa")).toBeInTheDocument();
    expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
  });

  it("assinatura ativa libera", async () => {
    checkCurrentUserSubscription.mockResolvedValue(ativa);
    renderGuard();
    expect(await screen.findByText("conteúdo protegido")).toBeInTheDocument();
  });

  // O dublê do useAuth devolve um `user` NOVO a cada render, de propósito: é o
  // cenário que transformava o efeito num laço contra a RPC.
  it("não martela a verificação quando o objeto user muda de identidade", async () => {
    checkCurrentUserSubscription.mockResolvedValue(ativa);
    renderGuard();
    await screen.findByText("conteúdo protegido");
    await new Promise((r) => setTimeout(r, 100));
    expect(checkCurrentUserSubscription).toHaveBeenCalledTimes(1);
  });
});
