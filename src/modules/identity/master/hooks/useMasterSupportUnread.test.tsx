import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../../../../../tests/helpers/supabase-mock";
import {
  useMasterSupportUnread,
  useMarkMasterRepliesRead,
} from "./useMasterSupportUnread";

const masterAuthMock = vi.fn();
vi.mock("./useMasterAuth", () => ({
  useMasterAuth: (...a: unknown[]) => masterAuthMock(...a),
}));

const h = vi.hoisted(() => ({
  channelFactory: vi.fn(),
  removeChannelMock: vi.fn(),
}));

let mock: ReturnType<typeof createMockSupabase>;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: unknown[]) =>
      (mock.sb as never as { from: (...x: unknown[]) => unknown }).from(...a),
    channel: (name: string) => h.channelFactory(name),
    removeChannel: (ch: unknown) => h.removeChannelMock(ch),
  },
}));

let lastOnConfig: Record<string, unknown> | null = null;

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}
const newQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const asMaster = () =>
  masterAuthMock.mockReturnValue({ isMaster: true, masterUser: { id: "mu-1" } });

const customerReply = (entityId: string | null) => ({
  id: crypto.randomUUID(),
  type: "support_ticket_customer_reply",
  entity_id: entityId,
  read_at: null,
});

beforeEach(() => {
  masterAuthMock.mockReset();
  h.channelFactory.mockReset();
  h.removeChannelMock.mockReset();
  lastOnConfig = null;
  mock = createMockSupabase();
  mock.mockTable("notifications", []);
  const channel: Record<string, unknown> = {
    on: (type: string, config: Record<string, unknown>) => {
      if (type === "postgres_changes") lastOnConfig = config;
      return channel;
    },
    subscribe: () => channel,
  };
  h.channelFactory.mockReturnValue(channel);
});

describe("useMasterSupportUnread", () => {
  it("does not query or subscribe when the user is not a master", () => {
    masterAuthMock.mockReturnValue({ isMaster: false });
    const { result } = renderHook(() => useMasterSupportUnread(), { wrapper: wrap(newQc()) });
    expect(result.current.total).toBe(0);
    expect(h.channelFactory).not.toHaveBeenCalled();
  });

  it("aggregates unread customer replies by Chamado", async () => {
    asMaster();
    mock.mockTable("notifications", [
      customerReply("ticket-A"),
      customerReply("ticket-A"),
      customerReply("ticket-B"),
    ]);

    const { result } = renderHook(() => useMasterSupportUnread(), { wrapper: wrap(newQc()) });

    await waitFor(() => expect(result.current.total).toBe(3));
    expect(result.current.byTicket).toEqual({ "ticket-A": 2, "ticket-B": 1 });
  });

  it("subscribes cross-org (no org filter) to notifications", () => {
    asMaster();
    renderHook(() => useMasterSupportUnread(), { wrapper: wrap(newQc()) });
    expect(h.channelFactory).toHaveBeenCalledWith("master-support-unread");
    expect(lastOnConfig).toMatchObject({ event: "*", schema: "public", table: "notifications" });
    expect(lastOnConfig).not.toHaveProperty("filter");
  });

  it("removes the channel on unmount", () => {
    asMaster();
    const { unmount } = renderHook(() => useMasterSupportUnread(), { wrapper: wrap(newQc()) });
    unmount();
    expect(h.removeChannelMock).toHaveBeenCalledTimes(1);
  });

  it("marks a ticket's customer replies read", async () => {
    const { result } = renderHook(() => useMarkMasterRepliesRead(), { wrapper: wrap(newQc()) });
    await result.current.mutateAsync("ticket-A");
    expect(result.current.isError).toBe(false);
  });
});
