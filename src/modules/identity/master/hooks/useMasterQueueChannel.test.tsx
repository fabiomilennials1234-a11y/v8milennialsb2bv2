import React from "react";
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const masterAuthMock = vi.fn();
vi.mock("./useMasterAuth", () => ({
  useMasterAuth: (...a: unknown[]) => masterAuthMock(...a),
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

import { useMasterQueueChannel } from "./useMasterQueueChannel";

const QUEUE_KEY = "master-support-tickets";
let eventHandler: (() => void) | null = null;
let lastOnConfig: Record<string, unknown> | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  masterAuthMock.mockReset();
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
  const view = renderHook(() => useMasterQueueChannel(), { wrapper });
  return { queryClient, invalidateSpy, ...view };
}

describe("useMasterQueueChannel", () => {
  it("does not subscribe when the user is not a master", () => {
    masterAuthMock.mockReturnValue({ isMaster: false });
    setup();
    expect(h.channelFactory).not.toHaveBeenCalled();
  });

  it("subscribes cross-org (no org filter) to all support_tickets events", () => {
    masterAuthMock.mockReturnValue({ isMaster: true });
    setup();
    expect(h.channelFactory).toHaveBeenCalledWith("master-support-queue");
    expect(lastOnConfig).toMatchObject({
      event: "*",
      schema: "public",
      table: "support_tickets",
    });
    expect(lastOnConfig).not.toHaveProperty("filter");
  });

  it("invalidates the queue once for a burst of events (debounced)", () => {
    masterAuthMock.mockReturnValue({ isMaster: true });
    const { invalidateSpy } = setup();

    eventHandler?.();
    eventHandler?.();
    eventHandler?.();
    vi.advanceTimersByTime(400);

    const queueCalls = invalidateSpy.mock.calls.filter(
      ([arg]) => (arg as { queryKey?: unknown[] })?.queryKey?.[0] === QUEUE_KEY,
    );
    expect(queueCalls).toHaveLength(1);
  });

  it("removes the channel on unmount", () => {
    masterAuthMock.mockReturnValue({ isMaster: true });
    const { unmount } = setup();
    unmount();
    expect(h.removeChannelMock).toHaveBeenCalledTimes(1);
  });
});
