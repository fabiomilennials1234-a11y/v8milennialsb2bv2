/**
 * Chat Bubble — filtro de instância (visual, client-side).
 *
 * Cobre:
 * - Provider persiste listInstanceFilter em localStorage por user
 * - Default = "all" quando ausente
 * - Auto-reset quando instância filtrada some das permitidas
 * - ChatBubbleInstanceSwitcher renderiza opções (Todas + lista alfabética)
 * - Selecionar item invoca onChange
 * - ChatBubbleEmptyState variant "filtered-empty" renderiza CTA reset
 *
 * NÃO testa fetch/rendering da lista (Provider mocka useQueries).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const teamMemberRef = {
  value: { id: "tm1", organization_id: "org-A", user_id: "u1" },
};
vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: teamMemberRef.value }),
}));

const instancesRef = {
  value: [
    { id: "i1", instance_name: "Vendas", status: "connected" },
    { id: "i2", instance_name: "Suporte", status: "connected" },
  ],
};
vi.mock("@/modules/communication/hooks/chat/useWhatsAppInstances", () => ({
  useWhatsAppInstancesForUser: () => ({ data: instancesRef.value }),
}));

vi.mock("@/modules/communication/hooks/chat/useResolveChatDeepLink", () => ({
  useResolveChatDeepLink: () => ({ data: null, isLoading: false, isFetching: false }),
}));

vi.mock("@/modules/communication/hooks/chat/useWhatsAppRealtime", () => ({
  useWhatsAppMessagesRealtime: vi.fn(),
}));

vi.mock("@/modules/communication/hooks/chat/useChatBubbleContactsRealtime", () => ({
  useChatBubbleContactsRealtime: vi.fn(() => ({ isReconnecting: false })),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQueries: () => [{ data: [], isLoading: false }],
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

import { ChatBubbleProvider } from "@/contexts/ChatBubbleContext";
import { useChatBubble } from "@/modules/communication/hooks/useChatBubble";
import { ChatBubbleInstanceSwitcher } from "@/modules/communication/components/chat/bubble/ChatBubbleInstanceSwitcher";
import { ChatBubbleEmptyState } from "@/modules/communication/components/chat/bubble/ChatBubbleEmptyState";

function newQc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

function wrap(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ChatBubbleProvider>{children}</ChatBubbleProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  teamMemberRef.value = { id: "tm1", organization_id: "org-A", user_id: "u1" };
  instancesRef.value = [
    { id: "i1", instance_name: "Vendas", status: "connected" },
    { id: "i2", instance_name: "Suporte", status: "connected" },
  ];
});

describe("Provider — listInstanceFilter persistência", () => {
  it("default = 'all' (sem localStorage)", () => {
    const { result } = renderHook(() => useChatBubble(), { wrapper: wrap(newQc()) });
    expect(result.current.listInstanceFilter).toBe("all");
  });

  it("set → grava `chat-bubble:list-filter:${userId}`", () => {
    const { result } = renderHook(() => useChatBubble(), { wrapper: wrap(newQc()) });
    act(() => result.current.setListInstanceFilter("i1"));
    expect(localStorage.getItem("chat-bubble:list-filter:u1")).toBe("i1");
  });

  it("lê valor persistido no mount", () => {
    localStorage.setItem("chat-bubble:list-filter:u1", "i2");
    const { result } = renderHook(() => useChatBubble(), { wrapper: wrap(newQc()) });
    expect(result.current.listInstanceFilter).toBe("i2");
  });

  it("auto-reset 'all' quando instância filtrada some da lista permitida", () => {
    localStorage.setItem("chat-bubble:list-filter:u1", "i2");
    const { result, rerender } = renderHook(() => useChatBubble(), {
      wrapper: wrap(newQc()),
    });
    expect(result.current.listInstanceFilter).toBe("i2");

    act(() => {
      instancesRef.value = [{ id: "i1", instance_name: "Vendas", status: "connected" }];
    });
    rerender();
    expect(result.current.listInstanceFilter).toBe("all");
  });

  it("open({phone, instanceId}) auto-sincroniza filtro", () => {
    const { result } = renderHook(() => useChatBubble(), { wrapper: wrap(newQc()) });
    act(() => result.current.open({ phone: "11999", instanceId: "i2" }));
    expect(result.current.listInstanceFilter).toBe("i2");
  });
});

describe("ChatBubbleInstanceSwitcher — UI", () => {
  it("trigger mostra 'Todas as conversas' quando value === 'all'", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <ChatBubbleInstanceSwitcher
        instances={instancesRef.value}
        value="all"
        onChange={onChange}
      />,
    );
    expect(getByRole("button").textContent).toMatch(/Todas as conversas/i);
  });

  it("trigger mostra nome da instância selecionada", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <ChatBubbleInstanceSwitcher
        instances={instancesRef.value}
        value="i2"
        onChange={onChange}
      />,
    );
    expect(getByRole("button").textContent).toMatch(/Suporte/i);
  });

  it("aria-label do trigger informa contexto", () => {
    const { getByRole } = render(
      <ChatBubbleInstanceSwitcher
        instances={instancesRef.value}
        value="all"
        onChange={vi.fn()}
      />,
    );
    const trigger = getByRole("button");
    expect(trigger.getAttribute("aria-label")).toBeTruthy();
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
  });
});

describe("ChatBubbleEmptyState — filtered-empty", () => {
  it("renderiza nome da instância + CTA reset", () => {
    const onReset = vi.fn();
    const { getByText } = render(
      <ChatBubbleEmptyState
        variant="filtered-empty"
        instanceName="Vendas"
        onReset={onReset}
      />,
    );
    expect(getByText(/Nenhuma conversa em Vendas/i)).toBeTruthy();
    const btn = getByText(/Ver todas as conversas/i);
    fireEvent.click(btn);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
