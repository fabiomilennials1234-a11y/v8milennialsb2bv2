/**
 * useContactAvatarUrl — chave de cache por org+telefone, sem consulta quando
 * desligado (grupo/social) ou sem org.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  org: "org-1" as string | null,
  load: vi.fn(async (_org: string, phone: string) => (phone === "5511999990001" ? "https://signed/a" : null)),
}));
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: h.org ? { organization_id: h.org } : null }),
}));
vi.mock("@/modules/communication/lib/contactAvatarLoader", () => ({ contactAvatarLoader: { load: h.load } }));

import { useContactAvatarUrl } from "@/modules/communication/hooks/chat/useContactAvatarUrl";

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  client = new QueryClient();
  h.org = "org-1";
  h.load.mockClear();
});

describe("useContactAvatarUrl", () => {
  it("devolve a URL assinada do loader, com chave por org e telefone", async () => {
    const { result } = renderHook(() => useContactAvatarUrl("5511999990001"), { wrapper });
    await waitFor(() => expect(result.current).toBe("https://signed/a"));
    expect(h.load).toHaveBeenCalledWith("org-1", "5511999990001");
    expect(client.getQueryData(["contact-avatar", "org-1", "5511999990001"])).toBe("https://signed/a");
  });

  it("sem foto → null", async () => {
    const { result } = renderHook(() => useContactAvatarUrl("5511999990002"), { wrapper });
    await waitFor(() => expect(h.load).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it.each([
    ["telefone nulo (grupo/social)", () => useContactAvatarUrl(null)],
    ["desligado", () => useContactAvatarUrl("5511999990001", { enabled: false })],
  ])("%s não consulta", async (_n, hook) => {
    const { result } = renderHook(hook, { wrapper });
    expect(result.current).toBeNull();
    expect(h.load).not.toHaveBeenCalled();
  });

  it("sem org não consulta", () => {
    h.org = null;
    renderHook(() => useContactAvatarUrl("5511999990001"), { wrapper });
    expect(h.load).not.toHaveBeenCalled();
  });
});
