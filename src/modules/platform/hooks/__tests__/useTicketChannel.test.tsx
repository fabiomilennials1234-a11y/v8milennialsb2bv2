import React from "react";
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

import { useTicketChannel } from "../useTicketChannel";

const COMMENTS_KEY = "support-ticket-comments";
const TICKET = "19929072-dba8-4871-a2e7-5f0a9cba7988";

let insertHandler: ((p: { new: unknown }) => void) | null = null;
let lastOnConfig: Record<string, unknown> | null = null;

function makeComment(id: string, created_at: string, body = "msg") {
  return {
    id,
    ticket_id: TICKET,
    author_user_id: null,
    body,
    is_internal: false,
    created_at,
  } as never;
}

function fireInsert(record: unknown) {
  insertHandler?.({ new: record });
}

beforeEach(() => {
  vi.clearAllMocks();
  insertHandler = null;
  lastOnConfig = null;
  const channel: Record<string, unknown> = {
    on: (type: string, config: Record<string, unknown>, cb: (p: { new: unknown }) => void) => {
      if (type === "postgres_changes" && config?.event === "INSERT") {
        insertHandler = cb;
        lastOnConfig = config;
      }
      return channel;
    },
    subscribe: () => channel,
  };
  h.channelFactory.mockReturnValue(channel);
});

function setup(seed?: unknown[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  if (seed !== undefined) queryClient.setQueryData([COMMENTS_KEY, TICKET], seed);
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  const view = renderHook(() => useTicketChannel(TICKET), { wrapper });
  return { queryClient, ...view };
}

describe("useTicketChannel", () => {
  it("subscribes to this ticket's comment inserts, scoped by ticket_id", () => {
    setup([]);
    expect(h.channelFactory).toHaveBeenCalledWith(`support-comments:${TICKET}`);
    expect(lastOnConfig).toMatchObject({
      event: "INSERT",
      schema: "public",
      table: "support_ticket_comments",
      filter: `ticket_id=eq.${TICKET}`,
    });
  });

  it("folds an incoming comment into the cache, ordered by created_at", () => {
    const c1 = makeComment("c1", "2026-07-17T10:00:00Z");
    const { queryClient } = setup([c1]);

    fireInsert(makeComment("c2", "2026-07-17T10:05:00Z", "reply from master"));

    const cache = queryClient.getQueryData([COMMENTS_KEY, TICKET]) as { id: string }[];
    expect(cache.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("dedups the sender's own echo by id", () => {
    const c1 = makeComment("c1", "2026-07-17T10:00:00Z");
    const { queryClient } = setup([c1]);

    fireInsert(makeComment("c1", "2026-07-17T10:00:00Z")); // same id echoes back

    const cache = queryClient.getQueryData([COMMENTS_KEY, TICKET]) as { id: string }[];
    expect(cache.map((c) => c.id)).toEqual(["c1"]);
  });

  it("does not fabricate a cache when the thread was never loaded", () => {
    const { queryClient } = setup(); // no seed -> undefined cache

    fireInsert(makeComment("c2", "2026-07-17T10:05:00Z"));

    expect(queryClient.getQueryData([COMMENTS_KEY, TICKET])).toBeUndefined();
  });

  it("ignores a malformed event with no row", () => {
    const c1 = makeComment("c1", "2026-07-17T10:00:00Z");
    const { queryClient } = setup([c1]);

    insertHandler?.({ new: undefined });

    const cache = queryClient.getQueryData([COMMENTS_KEY, TICKET]) as { id: string }[];
    expect(cache.map((c) => c.id)).toEqual(["c1"]);
  });

  it("removes the channel on unmount", () => {
    const { unmount } = setup([]);
    unmount();
    expect(h.removeChannelMock).toHaveBeenCalledTimes(1);
  });
});
