import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

const mockFrom = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-test", isReady: true }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useWebhooks } from "@/hooks/useWebhooks";

function mockWebhookQuery(data: unknown[]) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data, error: null }),
      }),
    }),
  });
}

describe("useWebhooks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches webhooks", async () => {
    mockWebhookQuery([
      { id: "w1", url: "https://example.com/hook", events: ["lead_created"], is_active: true },
    ]);
    const { result } = renderHook(() => useWebhooks(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it("returns empty when no webhooks", async () => {
    mockWebhookQuery([]);
    const { result } = renderHook(() => useWebhooks(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(0);
  });
});
