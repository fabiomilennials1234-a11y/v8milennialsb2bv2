// tests/unit/meta-link-lead-hook.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { rpc: (...args: any[]) => rpcMock(...args) },
}));

import { useMetaLinkLead } from "@/hooks/chat-meta/useMetaLinkLead";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useMetaLinkLead", () => {
  it("calls link_meta_conversation_to_lead RPC", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useMetaLinkLead(), { wrapper });
    await result.current.mutateAsync({ conversationId: "c1", leadId: "l1" });
    expect(rpcMock).toHaveBeenCalledWith("link_meta_conversation_to_lead", {
      p_conversation_id: "c1",
      p_lead_id: "l1",
    });
  });
});
