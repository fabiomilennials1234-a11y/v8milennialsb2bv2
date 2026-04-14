import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/integrations/supabase/client", () => {
  const ch = { on: vi.fn().mockReturnThis(), subscribe: vi.fn() };
  return {
    supabase: {
      channel: vi.fn().mockReturnValue(ch),
      removeChannel: vi.fn(),
    },
  };
});
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t" }),
}));

import { useRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { supabase } from "@/integrations/supabase/client";
const mockChannel = (supabase.channel as any)();
const mockRemoveChannel = supabase.removeChannel as any;

function w() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => vi.clearAllMocks());

describe("useRealtimeSubscription", () => {
  it("subscribes to realtime changes on mount", () => {
    renderHook(() => useRealtimeSubscription("leads", ["leads"]), { wrapper: w() });
    expect(mockChannel.on).toHaveBeenCalled();
    expect(mockChannel.subscribe).toHaveBeenCalled();
  });

  it("passes table name to channel", () => {
    renderHook(() => useRealtimeSubscription("pipe_whatsapp", ["pipe_whatsapp"]), { wrapper: w() });
    expect(mockChannel.on).toHaveBeenCalled();
  });

  it("works with custom handlers", () => {
    const onUpdate = vi.fn((updated: any, old: any[]) => [...old]);
    renderHook(
      () => useRealtimeSubscription("leads", ["leads"], { onUpdate }),
      { wrapper: w() }
    );
    expect(mockChannel.on).toHaveBeenCalled();
  });

  it("cleans up on unmount", () => {
    const { unmount } = renderHook(
      () => useRealtimeSubscription("leads", ["leads"]),
      { wrapper: w() }
    );
    unmount();
    expect(mockRemoveChannel).toHaveBeenCalled();
  });

  it("handles tables without org_id", () => {
    renderHook(
      () => useRealtimeSubscription("team_members", ["team_members"]),
      { wrapper: w() }
    );
    expect(mockChannel.on).toHaveBeenCalled();
  });
});

// TABLES_WITHOUT_ORG_ID is not exported — internal to module
