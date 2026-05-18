/**
 * Garantia: `useOpenWhatsAppChat()` propaga `instanceId` quando fornecido,
 * gerando `/chat-whatsapp?phone=X&instance=Y`. Quando o lead já sabe a
 * instância (via `primaryInstanceFor`), o `ChatShellWithContext` curto-circuita
 * `useResolveChatDeepLink` — sem ida ao servidor pra resolver deep-link.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import React from "react";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({
    data: { id: "tm1", organization_id: "org-1", role: "admin", user_id: "u1" },
  }),
  isVirtualTeamMember: (id: string) => id?.startsWith("master-virtual-"),
}));

import { useOpenWhatsAppChat } from "@/lib/whatsapp";

const wrapper =
  (qc: QueryClient) =>
  ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(MemoryRouter, null, children),
    );

beforeEach(() => {
  navigateMock.mockClear();
});

describe("useOpenWhatsAppChat", () => {
  it("navega sem `instance` quando não recebe instanceId", () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useOpenWhatsAppChat(), {
      wrapper: wrapper(qc),
    });
    result.current("11987654321");
    expect(navigateMock).toHaveBeenCalledTimes(1);
    const url = navigateMock.mock.calls[0][0] as string;
    expect(url).toContain("phone=5511987654321");
    expect(url).not.toContain("instance=");
  });

  it("propaga `instance` quando instanceId é fornecido", () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useOpenWhatsAppChat(), {
      wrapper: wrapper(qc),
    });
    result.current("11987654321", undefined, "inst-xyz");
    expect(navigateMock).toHaveBeenCalledTimes(1);
    const url = navigateMock.mock.calls[0][0] as string;
    expect(url).toContain("phone=5511987654321");
    expect(url).toContain("instance=inst-xyz");
  });

  it("ignora cliques sem telefone válido", () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useOpenWhatsAppChat(), {
      wrapper: wrapper(qc),
    });
    result.current("");
    result.current(undefined);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
