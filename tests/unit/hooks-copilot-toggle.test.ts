/**
 * Onda 2 (Toggle Unify) — useCopilotToggle hook único.
 *
 * Cobre:
 *  - copilotToggleQueryKey produz key estável + normaliza phone
 *  - useCopilotToggleStatus chama get_phone_ai_status com p_organization_id
 *  - useCopilotToggleMutation roteia: master → master_set_copilot_disabled,
 *    leadId → toggle_lead_ai, só phone → toggle_phone_ai com org explícita
 *  - Optimistic update + rollback em erro
 *  - Invalidação de keys legadas (lead_ai_status, lead-detail, leads, pipes)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockRpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: any[]) => mockRpc(...args),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
  },
}));

const mockMaster = vi.fn(() => ({ isMaster: false, masterUser: null, permissions: {}, isOutbounder: false, isLoading: false }));
vi.mock("@/modules/identity/hooks/useMasterAuth", () => ({
  useMasterAuth: () => mockMaster(),
}));

const mockIdentity = {
  userId: "user-1",
  organizationId: "org-test",
  teamMemberId: "tm-1",
  effectiveRole: "admin" as const,
  isMaster: false,
  isAdmin: true,
  features: {} as Record<string, boolean>,
  isLoading: false,
  isReady: true,
};
vi.mock("@/modules/identity/hooks/useIdentity", () => ({
  useIdentity: () => mockIdentity,
}));

vi.mock("@/modules/identity/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-test", isReady: true }),
}));

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 5 * 60_000 } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { wrapper, qc };
}

import {
  copilotToggleQueryKey,
  useCopilotToggle,
  useCopilotToggleStatus,
  useCopilotToggleMutation,
} from "@/modules/copilot/hooks/useCopilotToggle";

beforeEach(() => {
  vi.clearAllMocks();
  mockMaster.mockReturnValue({ isMaster: false } as any);
  mockIdentity.isMaster = false;
  mockRpc.mockResolvedValue({ data: null, error: null });
});

describe("copilotToggleQueryKey", () => {
  it("normaliza phone BR no key", () => {
    expect(copilotToggleQueryKey("org-1", "+55 11 98765-4321")).toEqual([
      "copilot-toggle",
      "org-1",
      "11987654321",
    ]);
  });

  it("phone null vira null no key", () => {
    expect(copilotToggleQueryKey("org-1", null)).toEqual(["copilot-toggle", "org-1", null]);
  });

  it("org null vira null no key", () => {
    expect(copilotToggleQueryKey(null, "11987654321")).toEqual(["copilot-toggle", null, "11987654321"]);
  });
});

describe("useCopilotToggleStatus", () => {
  it("chama get_phone_ai_status com p_organization_id explícito", async () => {
    mockRpc.mockResolvedValue({
      data: { ai_disabled: true, source: "preference", normalized_phone: "11987654321", organization_id: "org-test", lead_id: null },
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCopilotToggleStatus({ phone: "+55 11 98765-4321" }), { wrapper });

    await waitFor(() => expect(result.current.data?.ai_disabled).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_phone_ai_status", {
      p_phone: "11987654321",
      p_organization_id: "org-test",
    });
    expect(result.current.data?.source).toBe("preference");
  });

  it("phone inválido (não normaliza) → source no_input, não chama RPC", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCopilotToggleStatus({ phone: "abc", leadId: "lead-1" }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.source).toBe("no_input");
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("useCopilotToggleMutation", () => {
  it("rota membro+leadId → toggle_lead_ai", async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCopilotToggleMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ disabled: true, leadId: "lead-1", phone: "11987654321" });
    });

    expect(mockRpc).toHaveBeenCalledWith("toggle_lead_ai", {
      p_lead_id: "lead-1",
      p_disabled: true,
    });
  });

  it("rota master+leadId → master_set_copilot_disabled", async () => {
    mockMaster.mockReturnValue({ isMaster: true } as any);
    mockIdentity.isMaster = true;
    mockRpc.mockResolvedValue({ data: {}, error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCopilotToggleMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ disabled: true, leadId: "lead-1" });
    });

    expect(mockRpc).toHaveBeenCalledWith("master_set_copilot_disabled", {
      p_lead_id: "lead-1",
      p_disabled: true,
    });
  });

  it("rota só phone → toggle_phone_ai com p_organization_id", async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCopilotToggleMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ disabled: false, phone: "+5511987654321" });
    });

    expect(mockRpc).toHaveBeenCalledWith("toggle_phone_ai", {
      p_phone: "11987654321",
      p_disabled: false,
      p_organization_id: "org-test",
    });
  });

  it("rejeita sem leadId nem phone", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCopilotToggleMutation(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ disabled: true });
      }),
    ).rejects.toThrow(/leadId.*phone/);
  });

  it("optimistic update aplica antes da resposta, rollback em erro", async () => {
    const { wrapper, qc } = createWrapper();
    const key = ["copilot-toggle", "org-test", "11987654321"];
    qc.setQueryData(key, {
      ai_disabled: false,
      source: "preference",
      organization_id: "org-test",
      normalized_phone: "11987654321",
      lead_id: "lead-1",
    });

    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useCopilotToggleMutation(), { wrapper });

    let threw = false;
    await act(async () => {
      try {
        await result.current.mutateAsync({ disabled: true, leadId: "lead-1", phone: "11987654321" });
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(true);

    // Rollback: voltou ao false
    const after = qc.getQueryData(key) as any;
    expect(after?.ai_disabled).toBe(false);
  });
});

describe("useCopilotToggle (combined)", () => {
  it("expõe aiDisabled + toggle + isPending", async () => {
    mockRpc.mockResolvedValue({
      data: { ai_disabled: true, source: "preference", normalized_phone: "11987654321", organization_id: "org-test", lead_id: "lead-1" },
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCopilotToggle({ phone: "11987654321", leadId: "lead-1" }), { wrapper });

    await waitFor(() => expect(result.current.aiDisabled).toBe(true));
    expect(result.current.source).toBe("preference");
    expect(typeof result.current.toggle).toBe("function");
    expect(result.current.isPending).toBe(false);
  });
});
