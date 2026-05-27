/**
 * ChatComposerShell — testes de renderização por estado.
 *
 * Mockamos useLeadWriteInstance + role hooks para isolar a lógica
 * de roteamento de estado da implementação do hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { LeadWriteInstanceState } from "@/modules/leads";

// ─── Mock state ────────────────────────────────────────────
let mockState: LeadWriteInstanceState = { status: "loading" };
let mockIsAdmin = false;
let mockIsMaster = false;

// Mock the underlying source path. ChatComposerShell imports
// `useLeadWriteInstance` from the leads module barrel (`@/modules/leads`),
// which re-exports from this file — Vitest intercepts both.
vi.mock("@/modules/leads/hooks/useLeadWriteInstance", () => ({
  useLeadWriteInstance: () => ({
    state: mockState,
    isLoading: mockState.status === "loading",
    refetch: () => {},
  }),
}));

vi.mock("@/modules/identity/hooks/useUserRole", () => ({
  useIsAdmin: () => ({ isAdmin: mockIsAdmin, isLoading: false }),
  useFeaturePermissions: () => ({ data: {}, isLoading: false, isError: false }),
  useFeaturePermission: () => ({ allowed: true, isLoading: false, hasError: false }),
  useCanManageCopilot: () => ({ canManage: true, canCreate: true, canEdit: true, canDelete: true, canToggle: true, isLoading: false }),
  useCanManageWhatsApp: () => ({ canManage: true, isLoading: false }),
  useUserRole: () => ({ data: { role: "admin" }, isLoading: false }),
  useJobTitle: () => ({ jobTitle: "", isLoading: false }),
  useMetricType: () => ({ metricType: "sales", isLoading: false }),
  useHasRole: () => ({ hasRole: true, isLoading: false }),
}));

vi.mock("@/modules/identity/hooks/useMasterAuth", () => ({
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

vi.mock("@/modules/identity/hooks/useIdentity", () => ({
  useIdentity: () => ({
    userId: "user-1",
    organizationId: "org-1",
    teamMemberId: "tm-1",
    effectiveRole: (mockIsAdmin || mockIsMaster ? "admin" : "member") as const,
    isMaster: mockIsMaster,
    isAdmin: mockIsAdmin || mockIsMaster,
    features: {} as Record<string, boolean>,
    isLoading: false,
    isReady: true,
  }),
}));

import { ChatComposerShell } from "@/modules/communication/components/chat/composer/ChatComposerShell";

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

const InnerSentinel = () => (
  <div data-testid="inner-composer">composer-real</div>
);

// ─── Tests ─────────────────────────────────────────────────

describe("ChatComposerShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState = { status: "loading" };
    mockIsAdmin = false;
    mockIsMaster = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renderiza innerComposer cru quando canWrite=true (Estado 1)", () => {
    mockState = {
      status: "ok",
      instanceId: "inst-1",
      instanceName: "Vendas",
      ownerTeamMemberId: "tm-self",
      responsibleUserId: "tm-self",
      isOwn: true,
      canWrite: true,
    };

    const Wrapper = createWrapper();
    render(
      createElement(
        Wrapper,
        null,
        createElement(ChatComposerShell, {
          leadId: "lead-1",
          variant: "full",
          innerComposer: <InnerSentinel />,
        }),
      ),
    );

    expect(screen.getByTestId("inner-composer")).toBeInTheDocument();
    // No banner em Estado 1
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("Estado 2 (canWrite=false, instância alheia) — renderiza banner + innerComposer wrapped (full)", () => {
    mockState = {
      status: "ok",
      instanceId: "inst-1",
      instanceName: "Vendas",
      ownerTeamMemberId: "tm-other",
      responsibleUserId: "tm-other",
      isOwn: false,
      canWrite: false,
      ownerName: "Camila Souza",
      ownerFirstName: "Camila",
    };

    const Wrapper = createWrapper();
    render(
      createElement(
        Wrapper,
        null,
        createElement(ChatComposerShell, {
          leadId: "lead-1",
          variant: "full",
          innerComposer: <InnerSentinel />,
        }),
      ),
    );

    // Banner com role=status, aria-live=polite
    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("aria-live", "polite");
    expect(banner.textContent).toContain("Camila");
    expect(banner.textContent).toContain("notas internas");

    // Inner ainda montado mas wrapper bloqueado
    expect(screen.getByTestId("inner-composer")).toBeInTheDocument();
    const wrapper = screen.getByTestId("inner-composer").parentElement;
    expect(wrapper).toHaveAttribute("data-write-blocked", "true");
    expect(wrapper).toHaveAttribute("aria-hidden", "true");
  });

  it("Estado 2 compact — renderiza banner curto sem linha de notas", () => {
    mockState = {
      status: "ok",
      instanceId: "inst-1",
      instanceName: "Vendas",
      ownerTeamMemberId: "tm-other",
      responsibleUserId: "tm-other",
      isOwn: false,
      canWrite: false,
      ownerName: "Camila Souza",
      ownerFirstName: "Camila",
    };

    const Wrapper = createWrapper();
    render(
      createElement(
        Wrapper,
        null,
        createElement(ChatComposerShell, {
          leadId: "lead-1",
          variant: "compact",
          innerComposer: <InnerSentinel />,
        }),
      ),
    );

    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Camila");
    // Compact não inclui menção a notas
    expect(banner.textContent).not.toContain("notas internas");
  });

  it("Estado 3a (NO_RESPONSIBLE) admin — mostra CTA Atribuir responsável", () => {
    mockIsAdmin = true;
    mockState = {
      status: "error",
      errorCode: "NO_RESPONSIBLE",
      responsibleUserId: null,
    };

    const Wrapper = createWrapper();
    const onAssign = vi.fn();
    render(
      createElement(
        Wrapper,
        null,
        createElement(ChatComposerShell, {
          leadId: "lead-1",
          variant: "full",
          innerComposer: <InnerSentinel />,
          onAssignResponsible: onAssign,
        }),
      ),
    );

    expect(screen.queryByTestId("inner-composer")).not.toBeInTheDocument();
    const region = screen.getByRole("region", { name: /composer indisponível/i });
    expect(region).toBeInTheDocument();
    expect(screen.getByText(/Lead sem responsável/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Atribuir responsável/i })).toBeInTheDocument();
  });

  it("Estado 3a (NO_RESPONSIBLE) member — sem CTA, apenas texto explicativo", () => {
    mockState = {
      status: "error",
      errorCode: "NO_RESPONSIBLE",
      responsibleUserId: null,
    };

    const Wrapper = createWrapper();
    render(
      createElement(
        Wrapper,
        null,
        createElement(ChatComposerShell, {
          leadId: "lead-1",
          variant: "full",
          innerComposer: <InnerSentinel />,
          onAssignResponsible: vi.fn(),
        }),
      ),
    );

    expect(screen.getByText(/Lead sem responsável/i)).toBeInTheDocument();
    expect(screen.getByText(/Peça ao administrador/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Atribuir responsável/i })).not.toBeInTheDocument();
  });

  it("Estado 3b (NO_INSTANCE) admin — CTA Vincular número + Trocar responsável", () => {
    mockIsAdmin = true;
    mockState = {
      status: "error",
      errorCode: "NO_INSTANCE",
      responsibleUserId: "tm-resp",
      responsibleName: "Bruno Lima",
      responsibleFirstName: "Bruno",
    };

    const Wrapper = createWrapper();
    render(
      createElement(
        Wrapper,
        null,
        createElement(ChatComposerShell, {
          leadId: "lead-1",
          variant: "full",
          innerComposer: <InnerSentinel />,
          onLinkInstance: vi.fn(),
          onChangeResponsible: vi.fn(),
        }),
      ),
    );

    expect(screen.getByRole("button", { name: /Vincular número/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Trocar responsável/i })).toBeInTheDocument();
    // Título começa com primeiro nome do responsável.
    expect(
      screen.getByRole("heading", { level: 3 }).textContent,
    ).toMatch(/Bruno/);
  });

  it("Estado 3b (NO_INSTANCE) member — sem CTA", () => {
    mockState = {
      status: "error",
      errorCode: "NO_INSTANCE",
      responsibleUserId: "tm-resp",
      responsibleName: "Bruno Lima",
      responsibleFirstName: "Bruno",
    };

    const Wrapper = createWrapper();
    render(
      createElement(
        Wrapper,
        null,
        createElement(ChatComposerShell, {
          leadId: "lead-1",
          variant: "full",
          innerComposer: <InnerSentinel />,
          onLinkInstance: vi.fn(),
        }),
      ),
    );

    expect(screen.getByText(/ainda não tem um número de WhatsApp/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Vincular número/i })).not.toBeInTheDocument();
  });

  it("leadId null → renderiza innerComposer direto (legado preservado)", () => {
    const Wrapper = createWrapper();
    render(
      createElement(
        Wrapper,
        null,
        createElement(ChatComposerShell, {
          leadId: null,
          variant: "full",
          innerComposer: <InnerSentinel />,
        }),
      ),
    );

    expect(screen.getByTestId("inner-composer")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
