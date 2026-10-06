import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCreateSavedView, useDeleteSavedView, useSavedViews, useUpdateSavedView } from "@/modules/platform/hooks/useSavedViews";
import { supabase } from "@/integrations/supabase/client";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  org: "11111111-1111-1111-1111-111111111111" as string | null,
  user: "22222222-2222-2222-2222-222222222222" as string | null,
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: state.org }),
  useAuth: () => ({ user: state.user ? { id: state.user } : null }),
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { supabase: createClient("http://saved-views-test.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (...args: unknown[]) => state.fetch(...args) },
    accessToken: async () => "test-session-token",
  }) };
});

const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
const input = { name: "Quentes", entity_type: "leads" as const, filters: { q: "teste" }, is_shared: false };
beforeEach(() => {
  state.fetch.mockReset();
  state.org = "11111111-1111-1111-1111-111111111111";
  state.user = "22222222-2222-2222-2222-222222222222";
});
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); });

describe("views salvas — sessão e organização no contrato HTTP", () => {
  it("envia dono autenticado e organização selecionada, e invalida a listagem", async () => {
    state.fetch.mockResolvedValue(new Response(JSON.stringify({ id: "view-1", ...input, organization_id: state.org }), { status: 200 }));
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCreateSavedView(), { wrapper });
    await act(async () => { await result.current.mutateAsync(input); });
    const [url, init] = state.fetch.mock.calls[0];
    expect(String(url)).toContain("/rest/v1/saved_views");
    expect(new Headers(init.headers).get("x-torque-saved-views-org")).toBe(state.org);
    expect(JSON.parse(String(init.body))).toMatchObject({ ...input, owner_id: state.user, organization_id: state.org });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["saved_views", state.org] });
  });

  it.each(["user", "org"] as const)("não escreve sem %s", async missing => {
    state[missing] = null;
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateSavedView(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow(); });
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("invalida a org gravada quando o usuário troca de org durante o POST", async () => {
    const originalOrg = state.org;
    let respond!: (response: Response) => void;
    state.fetch.mockImplementation(() => new Promise<Response>(resolve => { respond = resolve; }));
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result, rerender } = renderHook(() => useCreateSavedView(), { wrapper });
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.mutateAsync(input); });
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
    expect(new Headers(state.fetch.mock.calls[0][1].headers).get("x-torque-saved-views-org")).toBe(originalOrg);
    state.org = "33333333-3333-3333-3333-333333333333";
    rerender();
    await act(async () => {
      respond(new Response(JSON.stringify({ id: "view-1", ...input, organization_id: originalOrg }), { status: 200 }));
      await pending;
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["saved_views", originalOrg] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["saved_views", state.org] });
    expect(new Headers(state.fetch.mock.calls[0][1].headers).get("x-torque-saved-views-org")).toBe(originalOrg);
  });

  it("filtra organização no GET e faz nova leitura ao trocar a organização", async () => {
    state.fetch.mockImplementation(() => Promise.resolve(new Response("[]", { status: 200 })));
    const { wrapper } = setup();
    const { result, rerender } = renderHook(() => useSavedViews("leads"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const first = new URL(String(state.fetch.mock.calls[0][0]));
    expect(first.searchParams.get("organization_id")).toBe(`eq.${state.org}`);
    expect(new Headers(state.fetch.mock.calls[0][1].headers).get("x-torque-saved-views-org")).toBe(state.org);
    expect(first.searchParams.get("entity_type")).toBe("eq.leads");
    state.org = "33333333-3333-3333-3333-333333333333";
    rerender();
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
    expect(new URL(String(state.fetch.mock.calls[1][0])).searchParams.get("organization_id")).toBe(`eq.${state.org}`);
    expect(new Headers(state.fetch.mock.calls[1][1].headers).get("x-torque-saved-views-org")).toBe(state.org);
  });

  it.each(["update", "delete"] as const)("%s mantém header, filtro e invalidação na org da operação após troca", async operation => {
    const originalOrg = state.org;
    let respond!: (response: Response) => void;
    state.fetch.mockImplementation(() => new Promise<Response>(resolve => { respond = resolve; }));
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result, rerender } = renderHook(() => ({ update: useUpdateSavedView(), delete: useDeleteSavedView() }), { wrapper });
    let pending!: Promise<unknown>;
    act(() => {
      pending = operation === "update"
        ? result.current.update.mutateAsync({ id: "view-1", entityType: "leads", name: "Atualizada" })
        : result.current.delete.mutateAsync({ id: "view-1", entityType: "leads" });
    });
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = state.fetch.mock.calls[0];
    expect(init.method).toBe(operation === "update" ? "PATCH" : "DELETE");
    expect(new URL(String(url)).searchParams.get("organization_id")).toBe(`eq.${originalOrg}`);
    expect(new URL(String(url)).searchParams.get("id")).toBe("eq.view-1");
    expect(new Headers(init.headers).get("x-torque-saved-views-org")).toBe(originalOrg);
    state.org = "33333333-3333-3333-3333-333333333333";
    rerender();
    await act(async () => {
      respond(operation === "update"
        ? new Response(JSON.stringify({ id: "view-1", organization_id: originalOrg }), { status: 200 })
        : new Response(null, { status: 204 }));
      await pending;
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["saved_views", originalOrg] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["saved_views", state.org] });
    expect(new Headers(init.headers).get("x-torque-saved-views-org")).toBe(originalOrg);
  });

  it("header de filtros salvos não vaza para outro builder no cliente compartilhado", async () => {
    state.fetch.mockImplementation(() => Promise.resolve(new Response("[]", { status: 200 })));
    const { wrapper } = setup();
    const { result } = renderHook(() => useSavedViews("leads"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await supabase.from("leads").select("id").limit(1);
    expect(new Headers(state.fetch.mock.calls[0][1].headers).get("x-torque-saved-views-org")).toBe(state.org);
    expect(new Headers(state.fetch.mock.calls[1][1].headers).has("x-torque-saved-views-org")).toBe(false);
  });
});
