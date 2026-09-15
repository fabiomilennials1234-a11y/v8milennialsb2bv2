import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseRealtimeChannelOptions } from "@/shared/realtime/useRealtimeChannel";
import { invalidateSalesMetrics } from "@/shared/realtime/invalidate-sales-metrics";
import { useSalesMetricsRealtime } from "./useSalesMetricsRealtime";
import { useMetricMeasure } from "./useMetricMeasure";

const mocks = vi.hoisted(() => ({
  org: { organizationId: "sampaio" as string | null, isReady: true },
  state: "joined",
  channel: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/modules/identity", () => ({ useOrganization: () => mocks.org }));
vi.mock("@/shared/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: (options: UseRealtimeChannelOptions) => {
    mocks.channel(options);
    return { state: mocks.state };
  },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));

const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  clients.push(client);
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
function event(options: UseRealtimeChannelOptions, org = "sampaio", eventType = "sale") {
  options.onEvent({ eventType: "INSERT", new: { organization_id: org, event_type: eventType } } as never);
}
function options() { return mocks.channel.mock.lastCall![0] as UseRealtimeChannelOptions; }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.org = { organizationId: "sampaio", isReady: true };
  mocks.state = "joined";
  mocks.rpc.mockResolvedValue({ data: { value: 0, empty_reason: "no_rows" }, error: null });
});
afterEach(() => { cleanup(); clients.splice(0).forEach((c) => c.clear()); vi.useRealTimers(); });

describe("sales metrics refresh", () => {
  it("updates a metric already open in two browsers after a sale and its reversal", async () => {
    const first = setup();
    const second = setup();
    const usePage = () => {
      useSalesMetricsRealtime();
      return useMetricMeasure({ measureRef: { kind: "leaf", id: "num_vendas" }, recorte: "total" });
    };
    const a = renderHook(usePage, { wrapper: first.wrapper });
    const firstChannel = options();
    const b = renderHook(usePage, { wrapper: second.wrapper });
    const secondChannel = options();
    await waitFor(() => { expect(a.result.current.data?.value).toBe(0); expect(b.result.current.data?.value).toBe(0); });
    expect(firstChannel).toMatchObject({ table: "sale_events", filter: "organization_id=eq.sampaio", enabled: true });

    mocks.rpc.mockResolvedValue({ data: { value: 1, empty_reason: null }, error: null });
    act(() => { event(firstChannel); event(secondChannel); });
    await waitFor(() => { expect(a.result.current.data?.value).toBe(1); expect(b.result.current.data?.value).toBe(1); });

    mocks.rpc.mockResolvedValue({ data: { value: 0, empty_reason: "no_rows" }, error: null });
    act(() => { event(firstChannel, "sampaio", "sale_reversed"); event(secondChannel, "sampaio", "sale_reversed"); });
    await waitFor(() => { expect(a.result.current.data?.value).toBe(0); expect(b.result.current.data?.value).toBe(0); });
  });

  it("invalidates all cached panels of this org, preserving other orgs and layouts", async () => {
    const { client } = setup();
    const affected = [
      ["metric-measure", "sampaio", "sales"],
      ["metric-measure", "sampaio", "revenue", "previous-month"],
      ["command-metrics", "start", "end", null, "sampaio"],
      ["ranking-data", 9, 2026, "range", "sampaio"],
    ];
    const untouched = [["metric-measure", "torque", "sales"], ["metrics-studio-panel", "sampaio", "panel"]];
    [...affected, ...untouched].forEach((key) => client.setQueryData(key, 0));
    await invalidateSalesMetrics(client, "sampaio");
    affected.forEach((key) => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
    untouched.forEach((key) => expect(client.getQueryState(key)?.isInvalidated).toBe(false));
    await invalidateSalesMetrics(client, null);
    untouched.forEach((key) => expect(client.getQueryState(key)?.isInvalidated).toBe(false));
  });

  it("ignores other orgs, groups bursts and cancels pending refresh on org switch/unmount", async () => {
    vi.useFakeTimers();
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const view = renderHook(useSalesMetricsRealtime, { wrapper });
    invalidate.mockClear();
    act(() => event(options(), "torque"));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(invalidate).not.toHaveBeenCalled();
    act(() => { event(options()); event(options(), "sampaio", "sale_adjusted"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(invalidate).toHaveBeenCalledTimes(1);
    act(() => event(options()));
    mocks.org = { organizationId: "torque", isReady: true };
    view.rerender();
    invalidate.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(invalidate).not.toHaveBeenCalled();
    expect(options().filter).toBe("organization_id=eq.torque");
    act(() => event(options(), "torque"));
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("catches up after connection loss and reconnect, without subscribing before org is ready", async () => {
    vi.useFakeTimers();
    mocks.org = { organizationId: null, isReady: false };
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const view = renderHook(useSalesMetricsRealtime, { wrapper });
    expect(options().enabled).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(invalidate).not.toHaveBeenCalled();
    mocks.org = { organizationId: "sampaio", isReady: true };
    mocks.state = "polling";
    view.rerender();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(invalidate).toHaveBeenCalledTimes(1);
    mocks.state = "joined";
    view.rerender();
    expect(invalidate).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(invalidate).toHaveBeenCalledTimes(2);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(invalidate).toHaveBeenCalledTimes(3);
  });
});
