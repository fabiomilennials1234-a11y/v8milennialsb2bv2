/**
 * ChatBubbleProvider + useChatBubble — transitions principais.
 *
 * Cobre:
 * - useChatBubble fora do Provider → throw
 * - useChatBubbleOptional fora do Provider → null
 * - open() / open({phone, instanceId}) / open({phone}) (deep-link) / open({leadName})
 * - close() reseta tudo
 * - selectConversation atualiza state + grava last_seen
 * - backToList limpa selecionados, mantém isOpen
 *
 * Mock: useCurrentTeamMember, useWhatsAppInstancesForUser,
 * useResolveChatDeepLink, useWhatsAppMessagesRealtime,
 * useChatBubbleContactsRealtime, supabase, useQueries.
 *
 * Auto-minimize observer não testado aqui (DOM API integration).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Hooks compartilhados mockados ───────────────────────────────────────────
const teamMemberRef = { value: { id: "tm1", organization_id: "org-A", user_id: "u1" } };
vi.mock("@/modules/identity/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: teamMemberRef.value }),
}));

const instancesRef = { value: [{ id: "i1", instance_name: "Vendas", status: "connected" }] };
vi.mock("@/hooks/chat/useWhatsAppInstances", () => ({
  useWhatsAppInstancesForUser: () => ({ data: instancesRef.value }),
}));

const deepLinkRef = {
  data: null as { instanceId: string; phoneNumber: string } | null,
  isLoading: false,
  isFetching: false,
};
const deepLinkSpy = vi.fn();
vi.mock("@/hooks/chat/useResolveChatDeepLink", () => ({
  useResolveChatDeepLink: (args: unknown) => {
    deepLinkSpy(args);
    return deepLinkRef;
  },
}));

vi.mock("@/hooks/chat/useWhatsAppRealtime", () => ({
  useWhatsAppMessagesRealtime: vi.fn(),
}));

vi.mock("@/hooks/chat/useChatBubbleContactsRealtime", () => ({
  useChatBubbleContactsRealtime: vi.fn(() => ({ isReconnecting: false })),
}));

// useQueries do Provider tenta carregar contacts via supabase pra unread total —
// mock retorna queries vazias, sem fetch real.
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQueries: () => [{ data: [], isLoading: false }],
  };
});

// supabase só chamado se useQueries do Provider invocasse queryFn — não vai porque mockamos useQueries.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

// normalizePhone canônico — usa real implementation.

import { ChatBubbleProvider } from "@/contexts/ChatBubbleContext";
import { useChatBubble, useChatBubbleOptional } from "@/hooks/useChatBubble";

// ── Wrappers ────────────────────────────────────────────────────────────────
function newQc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

function wrapWithProvider(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ChatBubbleProvider>{children}</ChatBubbleProvider>
    </QueryClientProvider>
  );
}

function wrapWithoutProvider(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  teamMemberRef.value = { id: "tm1", organization_id: "org-A", user_id: "u1" };
  instancesRef.value = [{ id: "i1", instance_name: "Vendas", status: "connected" }];
  deepLinkRef.data = null;
  deepLinkRef.isLoading = false;
  deepLinkRef.isFetching = false;
  deepLinkSpy.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────────────
describe("useChatBubble (consumer)", () => {
  it("useChatBubble fora do Provider → throw", () => {
    const qc = newQc();
    const original = console.error;
    console.error = vi.fn();
    expect(() =>
      renderHook(() => useChatBubble(), { wrapper: wrapWithoutProvider(qc) }),
    ).toThrow(/ChatBubbleProvider/);
    console.error = original;
  });

  it("useChatBubbleOptional fora do Provider → null", () => {
    const qc = newQc();
    const { result } = renderHook(() => useChatBubbleOptional(), {
      wrapper: wrapWithoutProvider(qc),
    });
    expect(result.current).toBeNull();
  });
});

describe("ChatBubbleProvider — transitions", () => {
  it("estado inicial: tudo zerado", () => {
    const qc = newQc();
    const { result } = renderHook(() => useChatBubble(), {
      wrapper: wrapWithProvider(qc),
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.isMinimized).toBe(false);
    expect(result.current.selectedPhone).toBeNull();
    expect(result.current.selectedInstanceId).toBeNull();
    expect(result.current.unreadTotal).toBe(0);
  });

  it("open() sem args → isOpen=true, sem seleção", () => {
    const qc = newQc();
    const { result } = renderHook(() => useChatBubble(), {
      wrapper: wrapWithProvider(qc),
    });
    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);
    expect(result.current.isMinimized).toBe(false);
    expect(result.current.selectedPhone).toBeNull();
    expect(result.current.selectedInstanceId).toBeNull();
  });

  it("open({phone, instanceId}) → seleciona direto, sem deep-link", () => {
    const qc = newQc();
    const { result } = renderHook(() => useChatBubble(), {
      wrapper: wrapWithProvider(qc),
    });
    act(() => result.current.open({ phone: "11999", instanceId: "i1" }));
    expect(result.current.selectedPhone).toBe("11999");
    expect(result.current.selectedInstanceId).toBe("i1");
    expect(result.current.isOpen).toBe(true);
  });

  it("open({phone}) sem instanceId → dispara resolução via useResolveChatDeepLink", () => {
    deepLinkRef.data = { instanceId: "i1", phoneNumber: "5511999" };
    const qc = newQc();
    const { result, rerender } = renderHook(() => useChatBubble(), {
      wrapper: wrapWithProvider(qc),
    });
    act(() => result.current.open({ phone: "5511999" }));
    rerender();
    // useResolveChatDeepLink foi invocado (Provider re-render dispara hook com phone novo)
    const calledWithPhone = deepLinkSpy.mock.calls.some(
      (call) => (call[0] as { phone?: string })?.phone === "5511999",
    );
    expect(calledWithPhone).toBe(true);
  });

  it("open({leadName}) sem phone → needsPhoneHint=true", () => {
    const qc = newQc();
    const { result } = renderHook(() => useChatBubble(), {
      wrapper: wrapWithProvider(qc),
    });
    act(() => result.current.open({ leadName: "Maria Silva" }));
    expect(result.current.needsPhoneHint).toBe(true);
    expect(result.current.pendingLeadName).toBe("Maria Silva");
  });

  it("acknowledgeNeedsPhone() apaga o hint", () => {
    const qc = newQc();
    const { result } = renderHook(() => useChatBubble(), {
      wrapper: wrapWithProvider(qc),
    });
    act(() => result.current.open({ leadName: "X" }));
    expect(result.current.needsPhoneHint).toBe(true);
    act(() => result.current.acknowledgeNeedsPhone());
    expect(result.current.needsPhoneHint).toBe(false);
  });

  it("close() reseta tudo (open, selecionados, leadName)", () => {
    const qc = newQc();
    const { result } = renderHook(() => useChatBubble(), {
      wrapper: wrapWithProvider(qc),
    });
    act(() => result.current.open({ phone: "11999", instanceId: "i1", leadName: "Lead X" }));
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.isMinimized).toBe(false);
    expect(result.current.selectedPhone).toBeNull();
    expect(result.current.selectedInstanceId).toBeNull();
    expect(result.current.pendingLeadName).toBeNull();
  });

  it("selectConversation atualiza state + grava whatsapp_last_seen_*", () => {
    const qc = newQc();
    const { result } = renderHook(() => useChatBubble(), {
      wrapper: wrapWithProvider(qc),
    });
    act(() => result.current.selectConversation("11987654321", "i1"));
    expect(result.current.selectedPhone).toBe("11987654321");
    expect(result.current.selectedInstanceId).toBe("i1");
    // last_seen escrito (chave normalizada)
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith("whatsapp_last_seen_"),
    );
    expect(keys.length).toBeGreaterThan(0);
  });

  it("backToList limpa selecionados, preserva isOpen", () => {
    const qc = newQc();
    const { result } = renderHook(() => useChatBubble(), {
      wrapper: wrapWithProvider(qc),
    });
    act(() => result.current.open({ phone: "11999", instanceId: "i1" }));
    act(() => result.current.backToList());
    expect(result.current.isOpen).toBe(true);
    expect(result.current.selectedPhone).toBeNull();
    expect(result.current.selectedInstanceId).toBeNull();
  });

  it("toggleMinimized flipa", () => {
    const qc = newQc();
    const { result } = renderHook(() => useChatBubble(), {
      wrapper: wrapWithProvider(qc),
    });
    act(() => result.current.open());
    expect(result.current.isMinimized).toBe(false);
    act(() => result.current.toggleMinimized());
    expect(result.current.isMinimized).toBe(true);
    act(() => result.current.toggleMinimized());
    expect(result.current.isMinimized).toBe(false);
  });
});

describe("ChatBubbleProvider — listInstanceFilter", () => {
  it("default = 'all' quando não há valor em localStorage", () => {
    const qc = newQc();
    const { result } = renderHook(() => useChatBubble(), {
      wrapper: wrapWithProvider(qc),
    });
    expect(result.current.listInstanceFilter).toBe("all");
  });

  it("setListInstanceFilter atualiza state e persiste no localStorage", () => {
    instancesRef.value = [
      { id: "i1", instance_name: "Vendas", status: "connected" },
      { id: "i2", instance_name: "Suporte", status: "connected" },
    ];
    const qc = newQc();
    const { result } = renderHook(() => useChatBubble(), {
      wrapper: wrapWithProvider(qc),
    });
    act(() => result.current.setListInstanceFilter("i2"));
    expect(result.current.listInstanceFilter).toBe("i2");
    expect(localStorage.getItem("chat-bubble:list-filter:u1")).toBe("i2");
  });

  it("estado inicial lê do localStorage", () => {
    localStorage.setItem("chat-bubble:list-filter:u1", "i1");
    const qc = newQc();
    const { result } = renderHook(() => useChatBubble(), {
      wrapper: wrapWithProvider(qc),
    });
    expect(result.current.listInstanceFilter).toBe("i1");
  });

  it("reset 'all' grava 'all' no localStorage", () => {
    instancesRef.value = [
      { id: "i1", instance_name: "Vendas", status: "connected" },
      { id: "i2", instance_name: "Suporte", status: "connected" },
    ];
    const qc = newQc();
    const { result } = renderHook(() => useChatBubble(), {
      wrapper: wrapWithProvider(qc),
    });
    act(() => result.current.setListInstanceFilter("i2"));
    act(() => result.current.setListInstanceFilter("all"));
    expect(result.current.listInstanceFilter).toBe("all");
    expect(localStorage.getItem("chat-bubble:list-filter:u1")).toBe("all");
  });

  it("auto-reset pra 'all' quando instância filtrada some das permitidas", () => {
    instancesRef.value = [
      { id: "i1", instance_name: "Vendas", status: "connected" },
      { id: "i2", instance_name: "Suporte", status: "connected" },
    ];
    localStorage.setItem("chat-bubble:list-filter:u1", "i2");
    const qc = newQc();
    const { result, rerender } = renderHook(() => useChatBubble(), {
      wrapper: wrapWithProvider(qc),
    });
    expect(result.current.listInstanceFilter).toBe("i2");
    // i2 removida da lista de permitidas
    act(() => {
      instancesRef.value = [{ id: "i1", instance_name: "Vendas", status: "connected" }];
    });
    rerender();
    expect(result.current.listInstanceFilter).toBe("all");
  });

  it("open({phone, instanceId}) auto-define filtro pra esse instanceId", () => {
    instancesRef.value = [
      { id: "i1", instance_name: "Vendas", status: "connected" },
      { id: "i2", instance_name: "Suporte", status: "connected" },
    ];
    const qc = newQc();
    const { result } = renderHook(() => useChatBubble(), {
      wrapper: wrapWithProvider(qc),
    });
    expect(result.current.listInstanceFilter).toBe("all");
    act(() => result.current.open({ phone: "11999", instanceId: "i2" }));
    expect(result.current.listInstanceFilter).toBe("i2");
  });

  it("listInstanceFilter NÃO impacta unreadTotal (badge soma todas)", () => {
    instancesRef.value = [
      { id: "i1", instance_name: "Vendas", status: "connected" },
      { id: "i2", instance_name: "Suporte", status: "connected" },
    ];
    const qc = newQc();
    const { result } = renderHook(() => useChatBubble(), {
      wrapper: wrapWithProvider(qc),
    });
    const unreadBefore = result.current.unreadTotal;
    act(() => result.current.setListInstanceFilter("i1"));
    expect(result.current.unreadTotal).toBe(unreadBefore);
  });
});

describe("Provider integração com Provider mount", () => {
  it("renderiza children sem crash", () => {
    const qc = newQc();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <ChatBubbleProvider>
          <div data-testid="child">child</div>
        </ChatBubbleProvider>
      </QueryClientProvider>,
    );
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
  });
});
