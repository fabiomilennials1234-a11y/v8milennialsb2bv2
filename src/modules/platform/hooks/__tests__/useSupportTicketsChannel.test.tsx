import React from "react";
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const orgMock = vi.fn();
vi.mock("@/modules/identity", () => ({
  useOrganization: (...a: unknown[]) => orgMock(...a),
}));

const h = vi.hoisted(() => ({
  channelFactory: vi.fn(),
  removeChannelMock: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string) => h.channelFactory(name),
    removeChannel: (ch: unknown) => h.removeChannelMock(ch),
  },
}));

import { useSupportTicketsChannel } from "../useSupportTicketsChannel";

const TICKETS_KEY = "support-tickets";
let eventHandler: (() => void) | null = null;
let lastOnConfig: Record<string, unknown> | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  orgMock.mockReset();
  h.channelFactory.mockReset();
  h.removeChannelMock.mockReset();
  eventHandler = null;
  lastOnConfig = null;
  const channel: Record<string, unknown> = {
    on: (type: string, config: Record<string, unknown>, cb: () => void) => {
      if (type === "postgres_changes") {
        eventHandler = cb;
        lastOnConfig = config;
      }
      return channel;
    },
    subscribe: () => channel,
  };
  h.channelFactory.mockReturnValue(channel);
});

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  const view = renderHook(() => useSupportTicketsChannel(), { wrapper });
  return { queryClient, invalidateSpy, ...view };
}

describe("useSupportTicketsChannel", () => {
  it("does not subscribe until the organization context is ready", () => {
    orgMock.mockReturnValue({ isReady: false });
    setup();
    expect(h.channelFactory).not.toHaveBeenCalled();
  });

  it("subscribes to all support_tickets events, scoped by RLS (no filter)", () => {
    orgMock.mockReturnValue({ isReady: true });
    setup();
    expect(h.channelFactory).toHaveBeenCalledWith("support-tickets-list");
    expect(lastOnConfig).toMatchObject({
      event: "*",
      schema: "public",
      table: "support_tickets",
    });
    expect(lastOnConfig).not.toHaveProperty("filter");
  });

  it("invalidates the tickets key once for a burst of events (debounced)", () => {
    orgMock.mockReturnValue({ isReady: true });
    const { invalidateSpy } = setup();

    eventHandler?.();
    eventHandler?.();
    vi.advanceTimersByTime(400);

    const calls = invalidateSpy.mock.calls.filter(
      ([arg]) => (arg as { queryKey?: unknown[] })?.queryKey?.[0] === TICKETS_KEY,
    );
    expect(calls).toHaveLength(1);
  });

  it("removes the channel on unmount", () => {
    orgMock.mockReturnValue({ isReady: true });
    const { unmount } = setup();
    unmount();
    expect(h.removeChannelMock).toHaveBeenCalledTimes(1);
  });
});
