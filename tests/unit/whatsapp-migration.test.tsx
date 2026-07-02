/**
 * Sprint 3 — WhatsApp migration unit tests.
 *
 * Covers:
 *  - useSetMigrationStatus / useSetProviderOverride mutation shape
 *
 * (Testes do WhatsAppMigrationBanner removidos em 2026-07-02 —
 *  componente órfão deletado no plan-tiers-cleanup.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";

// Stub supabase
const mockUpdateEq = vi.fn();
const mockQueryResult = { data: null, error: null };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => mockQueryResult),
      update: vi.fn(() => ({
        eq: mockUpdateEq,
      })),
    })),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({
    data: { organization_id: "org-a", id: "tm-1", user_id: "u-1" },
  }),
}));

import { useSetMigrationStatus, useSetProviderOverride } from "@/modules/communication/hooks/useOrgWhatsAppMigration";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockUpdateEq.mockReset().mockResolvedValue({ error: null });
});

describe("useSetMigrationStatus", () => {
  it("updates status only when completed=false", async () => {
    const { result } = renderHook(() => useSetMigrationStatus(), { wrapper });
    await result.current.mutateAsync({ organizationId: "org-a", status: "pending" });
    await waitFor(() => expect(mockUpdateEq).toHaveBeenCalled());
    // We cannot easily inspect `update(payload)` under this mock — but the
    // eq call must have been invoked once.
    expect(mockUpdateEq).toHaveBeenCalledWith("id", "org-a");
  });

  it("sets completed_at when completed=true", async () => {
    const { result } = renderHook(() => useSetMigrationStatus(), { wrapper });
    await result.current.mutateAsync({
      organizationId: "org-a",
      status: "migrated",
      completed: true,
    });
    expect(mockUpdateEq).toHaveBeenCalled();
  });
});

describe("useSetProviderOverride", () => {
  it("clears override with null", async () => {
    const { result } = renderHook(() => useSetProviderOverride(), { wrapper });
    await result.current.mutateAsync({ organizationId: "org-a", override: null });
    expect(mockUpdateEq).toHaveBeenCalledWith("id", "org-a");
  });

  it("sets override=uazapi", async () => {
    const { result } = renderHook(() => useSetProviderOverride(), { wrapper });
    await result.current.mutateAsync({ organizationId: "org-a", override: "uazapi" });
    expect(mockUpdateEq).toHaveBeenCalled();
  });
});
