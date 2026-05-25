// tests/unit/meta-conversation-profile-hook.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { functions: { invoke: (...args: any[]) => invokeMock(...args) } },
}));

import { useMetaConversationProfile } from "@/hooks/chat-meta/useMetaConversationProfile";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useMetaConversationProfile", () => {
  it("invokes edge function with conversationId on demand", async () => {
    invokeMock.mockResolvedValue({ data: { external_username: "alice", profile_pic_url: "https://x.png" }, error: null });

    const { result } = renderHook(() => useMetaConversationProfile(), { wrapper });
    await result.current.mutateAsync("conv-1");

    expect(invokeMock).toHaveBeenCalledWith("meta-conversation-profile", { body: { conversationId: "conv-1" } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
