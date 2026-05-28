// tests/unit/meta-conversations-hook.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { orderMock, isMock } = vi.hoisted(() => ({
  orderMock: vi.fn(),
  isMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: isMock,
    order: orderMock,
  };
  return { supabase: { from: vi.fn(() => builder) } };
});

vi.mock("@/modules/identity/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
}));

import { useMetaConversations } from "@/modules/communication/hooks/chat-meta/useMetaConversations";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useMetaConversations", () => {
  it("queries active conversations filtered by page+channel, ordered by last_message_at DESC", async () => {
    isMock.mockReturnThis();
    orderMock.mockResolvedValue({
      data: [{ id: "c1", last_message_at: "2026-05-25T10:00:00Z", organization_id: "org-1" }],
      error: null,
    });

    const { result } = renderHook(
      () => useMetaConversations({ pageId: "p1", channel: "instagram", tab: "active" }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(orderMock).toHaveBeenCalledWith("last_message_at", { ascending: false });
  });
});
