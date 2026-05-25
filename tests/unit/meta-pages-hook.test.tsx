// tests/unit/meta-pages-hook.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          { id: "p1", page_name: "Page 1", instagram_account_id: null, is_active: true, webhook_subscribed: true, organization_id: "org-1" },
          { id: "p2", page_name: "Page 2", instagram_account_id: "ig-2", is_active: true, webhook_subscribed: true, organization_id: "org-1" },
        ],
        error: null,
      }),
    })),
  },
}));

vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
}));

import { useMetaPages } from "@/hooks/chat-meta/useMetaPages";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useMetaPages", () => {
  it("groups pages by channel", async () => {
    const { result } = renderHook(() => useMetaPages(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.byChannel.messenger).toHaveLength(2);
    expect(result.current.data?.byChannel.instagram).toHaveLength(1);
    expect(result.current.data?.byChannel.instagram[0].id).toBe("p2");
  });
});
