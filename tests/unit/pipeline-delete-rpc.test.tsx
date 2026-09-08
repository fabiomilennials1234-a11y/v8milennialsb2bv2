import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDeletePipelineById, usePipelineDeleteImpact } from "@/modules/pipelines/hooks/config/usePipelineDelete";
import { rpcNaoTipada } from "@/modules/pipelines/lib/rpc-nao-tipada";

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/integrations/supabase/client", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { supabase: createClient("https://test.supabase.co", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: transport.fetch },
  }) };
});

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, wrapper: ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  ) };
}
beforeEach(() => {
  transport.fetch.mockReset();
  transport.fetch.mockImplementation(async () => new Response(JSON.stringify({ cards: 0, etapas: 2 }), {
    status: 200, headers: { "Content-Type": "application/json" },
  }));
});

describe("pipeline deletion through the real Supabase RPC client", () => {
  it("loads deletion impact before confirmation", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => usePipelineDeleteImpact("pipeline-1", true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ cards: 0, etapas: 2 });
    expect(String(transport.fetch.mock.calls[0][0])).toContain("/rpc/pipeline_delete_impact");
  });
  it("deletes the selected pipeline and invalidates its cached list", async () => {
    const { wrapper, client } = harness();
    client.setQueryData(["pipelines", "org-1"], []);
    const { result } = renderHook(() => useDeletePipelineById(), { wrapper });
    await act(async () => { await result.current.mutateAsync("pipeline-1"); });
    const [url, init] = transport.fetch.mock.calls[0];
    expect(String(url)).toContain("/rpc/delete_pipeline");
    expect(JSON.parse(init.body)).toEqual({ p_pipeline_id: "pipeline-1" });
    expect(client.getQueryState(["pipelines", "org-1"])?.isInvalidated).toBe(true);
  });
  it("propagates server rejection without invalidating the list", async () => {
    transport.fetch.mockImplementation(async () => new Response(JSON.stringify({ message: "access_denied", code: "42501" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    }));
    const { wrapper, client } = harness();
    client.setQueryData(["pipelines", "org-1"], []);
    const { result } = renderHook(() => useDeletePipelineById(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync("pipeline-1")).rejects.toThrow("access_denied"); });
    expect(client.getQueryState(["pipelines", "org-1"])?.isInvalidated).toBe(false);
  });
  it.each(["pipeline_stage_delete_impact", "delete_pipeline_stage", "enable_system_pipeline"])(
    "preserves the client receiver for %s", async (rpc) => {
      await expect(rpcNaoTipada(rpc, { p_pipeline_id: "pipeline-1" })).resolves.toMatchObject({ cards: 0 });
    },
  );
});
