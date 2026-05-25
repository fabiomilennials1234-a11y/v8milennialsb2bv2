// tests/unit/meta-messages-hook.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { limitMock, orderMock } = vi.hoisted(() => {
  const limit = vi.fn();
  return {
    limitMock: limit,
    orderMock: vi.fn(() => ({ limit })),
  };
});

vi.mock("@/integrations/supabase/client", () => {
  const conv = {
    id: "c1",
    organization_id: "org-1",
    meta_page_id: "p1",
    channel: "instagram",
    external_user_id: "user_x",
  };
  const pageRow = { page_id: "fb_page_123" };

  const fromMock = vi.fn((tbl: string) => {
    if (tbl === "meta_conversations") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: conv, error: null }),
      };
    }
    if (tbl === "meta_pages") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: pageRow, error: null }),
      };
    }
    // channel_messages
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: orderMock,
    };
  });

  return { supabase: { from: fromMock } };
});

import { useMetaMessages } from "@/hooks/chat-meta/useMetaMessages";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useMetaMessages", () => {
  it("fetches messages ordered by timestamp ASC limited to 200", async () => {
    limitMock.mockResolvedValue({ data: [{ id: "m1", content: "hi", timestamp: "2026-05-25T10:00:00Z" }], error: null });

    const { result } = renderHook(() => useMetaMessages("c1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(orderMock).toHaveBeenCalledWith("timestamp", { ascending: true });
    expect(limitMock).toHaveBeenCalledWith(200);
  });
});
