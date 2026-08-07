/**
 * Gating do ping de usuários ativos.
 *
 * O requisito é duro: NADA disso pode aparecer para quem não é master pleno.
 * `isMaster` não basta — o outbounder tem linha em `master_users` e passaria.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MasterOnlineIndicator } from "./MasterOnlineIndicator";

const mockUseMasterAuth = vi.fn();
const mockUseActivity = vi.fn();

vi.mock("../hooks/useMasterAuth", () => ({
  useMasterAuth: () => mockUseMasterAuth(),
}));

vi.mock("../hooks/useMasterUserActivity", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../hooks/useMasterUserActivity")
  >();
  return {
    ...actual,
    useMasterUserActivity: (...args: unknown[]) => mockUseActivity(...args),
  };
});

function renderIndicator() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MasterOnlineIndicator />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ONLINE_ROWS = [
  {
    organization_id: "org-1",
    org_name: "Cliente A",
    org_subscription_status: "active",
    member_id: "m1",
    user_id: "u1",
    member_name: "Fulano",
    member_email: "f@a.com",
    member_role: "admin",
    is_master: false,
    last_seen_at: new Date().toISOString(),
    is_online: true,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockUseActivity.mockReturnValue({
    data: ONLINE_ROWS,
    isLoading: false,
    isError: false,
  });
});

describe("MasterOnlineIndicator — quem enxerga", () => {
  it("NÃO renderiza nada para usuário comum", () => {
    mockUseMasterAuth.mockReturnValue({ isFullMaster: false, isMaster: false });
    const { container } = renderIndicator();
    expect(container).toBeEmptyDOMElement();
  });

  it("NÃO renderiza para OUTBOUNDER, mesmo sendo isMaster=true", () => {
    // Regressão: o outbounder tem linha ativa em master_users, então
    // `isMaster` é true. Gatear por isMaster vazaria a frota inteira p/ ele.
    mockUseMasterAuth.mockReturnValue({ isFullMaster: false, isMaster: true });
    const { container } = renderIndicator();
    expect(container).toBeEmptyDOMElement();
  });

  it("renderiza o total para master pleno", () => {
    mockUseMasterAuth.mockReturnValue({ isFullMaster: true, isMaster: true });
    renderIndicator();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("não dispara a query quando não é master pleno", () => {
    mockUseMasterAuth.mockReturnValue({ isFullMaster: false, isMaster: true });
    renderIndicator();
    expect(mockUseActivity).toHaveBeenCalledWith(60, { enabled: false });
  });

  it("conta PESSOAS distintas, não assentos (membro de 3 orgs = 1)", () => {
    mockUseMasterAuth.mockReturnValue({ isFullMaster: true, isMaster: true });
    mockUseActivity.mockReturnValue({
      data: [
        { ...ONLINE_ROWS[0], organization_id: "org-1", member_id: "m1" },
        { ...ONLINE_ROWS[0], organization_id: "org-2", member_id: "m2" },
        { ...ONLINE_ROWS[0], organization_id: "org-3", member_id: "m3" },
      ],
      isLoading: false,
      isError: false,
    });
    renderIndicator();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("mostra — em vez de 0 quando a RPC falha (não inventa dado)", () => {
    mockUseMasterAuth.mockReturnValue({ isFullMaster: true, isMaster: true });
    mockUseActivity.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    renderIndicator();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
