import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const inRangeDate = new Date(2026, 4, 20).toISOString();
const inRangeDate2 = new Date(2026, 4, 22, 8, 0, 0).toISOString();
const inRangeDate3 = new Date(2026, 4, 22, 14, 0, 0).toISOString();

const mockLeads = [
  { id: "l1", created_at: inRangeDate, source: "meta_ads" },
  { id: "l2", created_at: inRangeDate2, source: "meta_ads" },
  { id: "l3", created_at: inRangeDate3, source: "google_ads" },
  { id: "l4", created_at: inRangeDate, source: null },
];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            lte: () => Promise.resolve({ data: mockLeads, error: null }),
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));

import { useNewLeads } from "@/hooks/useNewLeads";

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useNewLeads", () => {
  const range = {
    start: new Date(2026, 4, 15, 0, 0, 0),
    end: new Date(2026, 4, 22, 23, 59, 59),
  };

  it("conta total + agrupa por dia + top sources", async () => {
    const { result } = renderHook(() => useNewLeads(range), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.total).toBe(4), { timeout: 3000 });

    // Buckets: 8 dias (15 a 22)
    expect(result.current.buckets.length).toBe(8);

    // Dia 20: 1 lead
    expect(result.current.buckets.find((b) => b.key === "2026-05-20")?.count).toBe(2); // l1 + l4
    // Dia 22: 2 leads (l2, l3)
    expect(result.current.buckets.find((b) => b.key === "2026-05-22")?.count).toBe(2);

    // Top sources: meta_ads (2), google_ads (1), null/— (1)
    expect(result.current.topSources[0].source).toBe("meta_ads");
    expect(result.current.topSources[0].count).toBe(2);
  });
});
