/**
 * useLeadWriteInstance — testes unitários.
 *
 * Cobre os 6 caminhos da matriz da Etapa C:
 *   1. leadId null → loading (não dispara RPC)
 *   2. RPC retorna LEAD_NOT_FOUND
 *   3. RPC retorna NO_RESPONSIBLE
 *   4. RPC retorna NO_INSTANCE (lead com responsável + sem instância vinculada)
 *   5. Sucesso: user é owner → canWrite=true, isOwn=true
 *   6. Sucesso: user não é owner + admin → canWrite=true, isOwn=false
 *   7. Sucesso: user não é owner + member → canWrite=false
 *
 * Mocks seguem o padrão de tests/unit/use-user-role.test.ts (vi.mock no
 * nível do módulo + state mutável por teste).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

// ─── Estado mutável ────────────────────────────────────────
const mockUser = { id: "user-1", email: "test@example.com" };
let mockTeamMember: { id: string; role: string; organization_id: string } | null = null;
let mockIsMaster = false;
let mockRpcResult: {
  instance_id: string | null;
  instance_name: string | null;
  owner_team_member_id: string | null;
  responsible_user_id: string | null;
  error_code: string | null;
} | null = null;
let mockTeamMemberRows: Array<{ id: string; name: string }> = [];

// ─── Mock supabase ─────────────────────────────────────────
const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getSession: vi.fn() },
  },
}));

// ─── Mock contexts/hooks dependentes ───────────────────────
vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, session: null, loading: false }),
}));

vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: mockTeamMember, isLoading: false }),
  isVirtualTeamMember: (id: string | null | undefined) =>
    !!id?.startsWith("master-virtual-"),
}));

vi.mock("@/modules/identity/master/hooks/useMasterAuth", () => ({
  useMasterAuth: () => ({
    isMaster: mockIsMaster,
    masterUser: null,
    permissions: {},
    hasPermission: () => false,
    isLoading: false,
    error: null,
    isOutbounder: false,
  }),
}));

vi.mock("@/modules/identity/auth/hooks/useIdentity", () => ({
  useIdentity: () => ({
    userId: mockUser.id,
    organizationId: mockTeamMember?.organization_id ?? null,
    teamMemberId: mockTeamMember?.id ?? null,
    effectiveRole: (mockIsMaster || mockTeamMember?.role === "admin" ? "admin" : "member") as const,
    isMaster: mockIsMaster,
    isAdmin: mockIsMaster || mockTeamMember?.role === "admin",
    features: {} as Record<string, boolean>,
    isLoading: false,
    isReady: !!mockTeamMember,
  }),
}));

// useUserRole consumed by hook → return based on team_member.
vi.mock("@/modules/identity/permissions/hooks/useUserRole", () => ({
  useUserRole: () => ({
    data: mockTeamMember
      ? { user_id: mockUser.id, role: mockTeamMember.role }
      : null,
    isLoading: false,
  }),
  useIsAdmin: () => ({
    isAdmin: mockTeamMember?.role === "admin",
    isLoading: false,
  }),
  useFeaturePermissions: () => ({ data: {}, isLoading: false, isError: false }),
  useFeaturePermission: () => ({ allowed: true, isLoading: false, hasError: false }),
  useCanManageCopilot: () => ({ canManage: true, canCreate: true, canEdit: true, canDelete: true, canToggle: true, isLoading: false }),
  useCanManageWhatsApp: () => ({ canManage: true, isLoading: false }),
  useJobTitle: () => ({ jobTitle: "", isLoading: false }),
  useMetricType: () => ({ metricType: "sales", isLoading: false }),
  useHasRole: () => ({ hasRole: true, isLoading: false }),
}));

vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({
    organizationId: mockTeamMember?.organization_id ?? null,
    teamMemberId: mockTeamMember?.id ?? null,
    role: mockTeamMember?.role ?? null,
    orgType: "crm",
    isLoading: false,
    isReady: !!mockTeamMember?.organization_id,
    error: null,
  }),
}));

// Feature flag default ON nos testes (cenário pós-cutover). Override por teste
// quando precisar simular flag OFF.
let mockIsStrict = true;
vi.mock("@/modules/communication/hooks/useUserWriteInstanceFlag", () => ({
  useUserWriteInstanceFlag: () => ({
    isStrict: mockIsStrict,
    isLoading: false,
  }),
}));

// ─── Import after mocks ────────────────────────────────────
import { useLeadWriteInstance } from "@/modules/leads";

// ─── Helpers ───────────────────────────────────────────────
function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

function setupRpcMock() {
  mockRpc.mockImplementation(async (fn: string) => {
    if (fn === "get_lead_write_instance") {
      return { data: mockRpcResult ? [mockRpcResult] : null, error: null };
    }
    return { data: null, error: null };
  });
}

function setupFromMock() {
  // useLeadWriteInstance lookup: from("team_members").select("id, name").eq(...).in(...)
  mockFrom.mockImplementation((table: string) => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: table === "team_members" ? mockTeamMemberRows : [],
        error: null,
      }),
    };
    return chain;
  });
}

// ─── Tests ─────────────────────────────────────────────────

describe("useLeadWriteInstance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTeamMember = { id: "tm-self", role: "member", organization_id: "org-1" };
    mockIsMaster = false;
    mockIsStrict = true;
    mockRpcResult = null;
    mockTeamMemberRows = [];
    setupRpcMock();
    setupFromMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("leadId null → state loading sem disparar RPC", () => {
    const { result } = renderHook(() => useLeadWriteInstance(null), {
      wrapper: createWrapper(),
    });
    expect(result.current.state.status).toBe("loading");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("RPC LEAD_NOT_FOUND → state error com errorCode correto", async () => {
    mockRpcResult = {
      instance_id: null,
      instance_name: null,
      owner_team_member_id: null,
      responsible_user_id: null,
      error_code: "LEAD_NOT_FOUND",
    };

    const { result } = renderHook(() => useLeadWriteInstance("lead-x"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    if (result.current.state.status !== "error") throw new Error("expected error");
    expect(result.current.state.errorCode).toBe("LEAD_NOT_FOUND");
  });

  it("RPC NO_RESPONSIBLE → errorCode + responsibleUserId null", async () => {
    mockRpcResult = {
      instance_id: null,
      instance_name: null,
      owner_team_member_id: null,
      responsible_user_id: null,
      error_code: "NO_RESPONSIBLE",
    };

    const { result } = renderHook(() => useLeadWriteInstance("lead-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    if (result.current.state.status !== "error") throw new Error("expected error");
    expect(result.current.state.errorCode).toBe("NO_RESPONSIBLE");
    expect(result.current.state.responsibleUserId).toBeNull();
  });

  it("RPC NO_INSTANCE → errorCode + responsibleUserId resolvido + nome lookup", async () => {
    mockRpcResult = {
      instance_id: null,
      instance_name: null,
      owner_team_member_id: null,
      responsible_user_id: "tm-resp",
      error_code: "NO_INSTANCE",
    };
    mockTeamMemberRows = [{ id: "tm-resp", name: "Camila Souza" }];

    const { result } = renderHook(() => useLeadWriteInstance("lead-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    if (result.current.state.status !== "error") throw new Error("expected error");
    expect(result.current.state.errorCode).toBe("NO_INSTANCE");
    expect(result.current.state.responsibleUserId).toBe("tm-resp");
    await waitFor(() =>
      expect(result.current.state.status === "error" && result.current.state.responsibleFirstName).toBe("Camila"),
    );
  });

  it("OK + user é owner da instância → canWrite=true, isOwn=true", async () => {
    mockRpcResult = {
      instance_id: "inst-1",
      instance_name: "Vendas SP",
      owner_team_member_id: "tm-self",
      responsible_user_id: "tm-self",
      error_code: null,
    };

    const { result } = renderHook(() => useLeadWriteInstance("lead-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.status).toBe("ok"));
    if (result.current.state.status !== "ok") throw new Error("expected ok");
    expect(result.current.state.isOwn).toBe(true);
    expect(result.current.state.canWrite).toBe(true);
    expect(result.current.state.instanceId).toBe("inst-1");
    expect(result.current.state.instanceName).toBe("Vendas SP");
  });

  it("OK + user não é owner + admin → canWrite=true, isOwn=false", async () => {
    mockTeamMember = { id: "tm-admin", role: "admin", organization_id: "org-1" };
    mockRpcResult = {
      instance_id: "inst-1",
      instance_name: "Vendas SP",
      owner_team_member_id: "tm-other",
      responsible_user_id: "tm-other",
      error_code: null,
    };
    mockTeamMemberRows = [{ id: "tm-other", name: "Bruno Lima" }];

    const { result } = renderHook(() => useLeadWriteInstance("lead-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.status).toBe("ok"));
    if (result.current.state.status !== "ok") throw new Error("expected ok");
    expect(result.current.state.isOwn).toBe(false);
    expect(result.current.state.canWrite).toBe(true); // admin bypass
  });

  it("OK + user não é owner + member → canWrite=false, banner state", async () => {
    mockTeamMember = { id: "tm-self", role: "member", organization_id: "org-1" };
    mockRpcResult = {
      instance_id: "inst-1",
      instance_name: "Vendas SP",
      owner_team_member_id: "tm-other",
      responsible_user_id: "tm-other",
      error_code: null,
    };
    mockTeamMemberRows = [{ id: "tm-other", name: "Camila Souza" }];

    const { result } = renderHook(() => useLeadWriteInstance("lead-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.status).toBe("ok"));
    if (result.current.state.status !== "ok") throw new Error("expected ok");
    expect(result.current.state.isOwn).toBe(false);
    expect(result.current.state.canWrite).toBe(false);
    await waitFor(() =>
      expect(result.current.state.status === "ok" && result.current.state.ownerFirstName).toBe("Camila"),
    );
  });

  it("OK + master user (não é admin nem owner) → canWrite=true (bypass)", async () => {
    mockTeamMember = { id: "tm-master-shadow", role: "admin", organization_id: "org-1" };
    mockIsMaster = true;
    mockRpcResult = {
      instance_id: "inst-1",
      instance_name: "Vendas SP",
      owner_team_member_id: "tm-other",
      responsible_user_id: "tm-other",
      error_code: null,
    };

    const { result } = renderHook(() => useLeadWriteInstance("lead-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.status).toBe("ok"));
    if (result.current.state.status !== "ok") throw new Error("expected ok");
    expect(result.current.state.canWrite).toBe(true);
  });

  it("flag OFF (default) → curto-circuito legado: canWrite=true sem chamar RPC", async () => {
    mockIsStrict = false;
    mockTeamMember = { id: "tm-self", role: "member", organization_id: "org-1" };

    const { result } = renderHook(() => useLeadWriteInstance("lead-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.status).toBe("ok"));
    if (result.current.state.status !== "ok") throw new Error("expected ok");
    expect(result.current.state.canWrite).toBe(true);
    expect(result.current.state.isOwn).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("RPC error (ex: função inexistente) → degrada Estado 1 sem bloquear composer", async () => {
    mockIsStrict = true;
    mockTeamMember = { id: "tm-self", role: "member", organization_id: "org-1" };
    mockRpc.mockImplementationOnce(async () => ({
      data: null,
      error: { message: "function get_lead_write_instance does not exist" },
    }));

    const { result } = renderHook(() => useLeadWriteInstance("lead-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.status).toBe("ok"));
    if (result.current.state.status !== "ok") throw new Error("expected ok");
    expect(result.current.state.canWrite).toBe(true);
  });
});
