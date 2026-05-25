// tests/unit/meta-send-hook.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { invokeMock, fromMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    functions: { invoke: (...a: any[]) => invokeMock(...a) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (...a: any[]) => fromMock(...a),
  },
}));

import { useMetaSend } from "@/hooks/chat-meta/useMetaSend";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useMetaSend", () => {
  it("invokes send-meta-message with correct payload", async () => {
    const convLookup = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          organization_id: "org-1",
          channel: "instagram",
          external_user_id: "ig_user",
          meta_page_id: "p-uuid",
        },
        error: null,
      }),
    };
    const pageLookup = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { page_id: "fb_page_123" }, error: null }),
    };
    fromMock.mockImplementation((tbl: string) =>
      tbl === "meta_conversations" ? convLookup : pageLookup
    );
    invokeMock.mockResolvedValue({ data: { success: true, message_id: "mid" }, error: null });

    const { result } = renderHook(() => useMetaSend(), { wrapper });
    await result.current.mutateAsync({ conversationId: "c1", text: "hello" });

    expect(invokeMock).toHaveBeenCalledWith("send-meta-message", {
      body: {
        recipientId: "ig_user",
        channel: "instagram",
        message: "hello",
        pageId: "fb_page_123",
        mediaUrl: undefined,
        mediaType: undefined,
      },
    });
  });
});
