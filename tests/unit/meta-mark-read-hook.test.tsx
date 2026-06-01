// tests/unit/meta-mark-read-hook.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { rpc: (...args: any[]) => rpcMock(...args) },
}));

import { useMetaMarkAsRead } from "@/modules/communication/hooks/chat-meta/useMetaMarkAsRead";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useMetaMarkAsRead", () => {
  it("calls mark_meta_conversation_read RPC", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useMetaMarkAsRead(), { wrapper });
    await result.current.mutateAsync("conv-1");
    expect(rpcMock).toHaveBeenCalledWith("mark_meta_conversation_read", { p_conversation_id: "conv-1" });
  });
});
