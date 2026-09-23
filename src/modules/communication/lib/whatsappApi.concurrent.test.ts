import { createElement, type ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMessageLimits } from "../hooks/useMessageLimits";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { getInstanceStatus, getMessageLimits, connectInstanceQR, sendLocation } from "./whatsappApi";

const { fetchMock, authView } = vi.hoisted(() => ({ fetchMock: vi.fn(), authView: { user: { id: "user-a" } as { id: string } | null } }));
vi.mock("@/modules/identity", () => ({ useAuth: () => authView }));
vi.mock("@/integrations/supabase/client", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { supabase: createClient("https://whatsapp.example.com", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchMock },
  }) };
});
const response = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), {
  headers: { "Content-Type": "application/json" },
});
function pendingResponse() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function session(user = "user-a", token = "token-a") {
  vi.spyOn(supabase.auth, "getSession").mockResolvedValue({ data: { session: {
    access_token: token, refresh_token: "refresh", expires_in: 3600,
    token_type: "bearer", user: { id: user },
  } }, error: null } as Awaited<ReturnType<typeof supabase.auth.getSession>>);
}
beforeEach(() => { vi.restoreAllMocks(); fetchMock.mockReset(); vi.stubGlobal("localStorage", window.localStorage); localStorage.clear(); authView.user = { id: "user-a" }; session(); });

describe("concurrent WhatsApp reads through the real HTTP client", () => {
  it.each([getInstanceStatus, getMessageLimits])("shares simultaneous reads and requests fresh data after completion", async (read) => {
    const pending = pendingResponse();
    fetchMock.mockReturnValueOnce(pending.promise);
    const one = read("instance-a", "org-a");
    const two = read("instance-a", "org-a");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    pending.resolve(response({ connected: true }));
    expect(await Promise.all([one, two])).toEqual([{ connected: true }, { connected: true }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(response({ connected: false }));
    expect(await read("instance-a", "org-a")).toEqual({ connected: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("read isolation and recovery", () => {
  it.each(["organization", "instance", "user", "session", "action"])("does not share a different %s", async (scope) => {
    const pending = pendingResponse();
    fetchMock.mockImplementation(() => pending.promise.then(r => r.clone()));
    const first = getInstanceStatus("instance-a", "org-a");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    if (scope === "user") session("user-b", "token-b");
    if (scope === "session") session("user-a", "token-refreshed");
    const second = scope === "action"
      ? getMessageLimits("instance-a", "org-a")
      : getInstanceStatus(scope === "instance" ? "instance-b" : "instance-a", scope === "organization" ? "org-b" : "org-a");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    pending.resolve(response({ connected: true }));
    await Promise.all([first, second]);
    const request = fetchMock.mock.calls[1][1] as RequestInit;
    expect(new Headers(request.headers).get("Authorization")).toBe(`Bearer ${scope === "user" ? "token-b" : scope === "session" ? "token-refreshed" : "token-a"}`);
  });

  it("captures the fallback organization before an in-flight organization switch", async () => {
    const pending = pendingResponse();
    fetchMock.mockImplementation(() => pending.promise.then(r => r.clone()));
    localStorage.setItem("selected_org_id", "org-a");
    const first = getMessageLimits("instance-a");
    localStorage.setItem("selected_org_id", "org-b");
    const second = getMessageLimits("instance-a");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body).organization_id)).toEqual(["org-a", "org-b"]);
    pending.resolve(response({ current: 10 }));
    await Promise.all([first, second]);
  });

  it("never joins an authenticated request after logout", async () => {
    const pending = pendingResponse();
    fetchMock.mockImplementation(() => pending.promise.then(r => r.clone()));
    const first = getInstanceStatus("instance-a", "org-a");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
    const second = getInstanceStatus("instance-a", "org-a");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    pending.resolve(response({ connected: false }));
    await Promise.all([first, second]);
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get("Authorization")).toBe("Bearer test-key");
  });

  it.each(["http", "provider", "invalid-json"])("shares %s failure and allows the next read to retry", async (failure) => {
    const pending = pendingResponse();
    fetchMock.mockReturnValueOnce(pending.promise);
    const first = getMessageLimits("instance-a", "org-a");
    const second = getMessageLimits("instance-a", "org-a");
    const settled = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    pending.resolve(failure === "http"
      ? new Response(JSON.stringify({ error: "provider unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } })
      : failure === "provider" ? new Response(JSON.stringify({ ok: false, error: "provider unavailable" }), { headers: { "Content-Type": "application/json" } })
      : new Response("not-json", { headers: { "Content-Type": "application/json" } }));
    const results = await settled;
    expect(results.every(result => result.status === "rejected")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(response({ current: 12 }));
    expect(await getMessageLimits("instance-a", "org-a")).toEqual({ current: 12 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not deduplicate lifecycle mutations", async () => {
    fetchMock.mockImplementation(async () => response({ qrcode: "fresh-qr" }));
    await Promise.all([connectInstanceQR("instance-a", undefined, "org-a"), connectInstanceQR("instance-a", undefined, "org-a")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

const clients: QueryClient[] = [];
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });

describe("message limits hook across auth and tenant changes", () => {
  it("shares transport across independent query clients without sharing settled cache", async () => {
    const pending = pendingResponse();
    fetchMock.mockReturnValueOnce(pending.promise);
    const first = renderHook(() => useMessageLimits("instance-a", "org-a"), { wrapper: wrapper() });
    const second = renderHook(() => useMessageLimits("instance-a", "org-a"), { wrapper: wrapper() });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    pending.resolve(response({ current: 12 }));
    await waitFor(() => expect(first.result.current.data).toEqual({ current: 12 }));
    await waitFor(() => expect(second.result.current.data).toEqual({ current: 12 }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not display or fetch the previous user's limits after logout", async () => {
    fetchMock.mockImplementation(async () => response({ current: 12 }));
    const hook = renderHook(() => useMessageLimits("instance-a", "org-a"), { wrapper: wrapper() });
    await waitFor(() => expect(hook.result.current.data).toEqual({ current: 12 }));
    authView.user = null;
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
    hook.rerender();
    expect(hook.result.current.data).toBeUndefined();
    expect(hook.result.current.fetchStatus).toBe("idle");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    session("user-b", "token-b");
    authView.user = { id: "user-b" };
    fetchMock.mockImplementation(async () => response({ current: 25 }));
    hook.rerender();
    expect(hook.result.current.data).toBeUndefined();
    await waitFor(() => expect(hook.result.current.data).toEqual({ current: 25 }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])("isolates an organization change (explicit=%s), including a late response", async (explicit) => {
    const pending = pendingResponse();
    fetchMock.mockReturnValueOnce(pending.promise).mockImplementation(async () => response({ current: 25 }));
    localStorage.setItem("selected_org_id", "org-a");
    const hook = renderHook(({ org }) => useMessageLimits("instance-a", explicit ? org : undefined), {
      initialProps: { org: "org-a" }, wrapper: wrapper(),
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    localStorage.setItem("selected_org_id", "org-b");
    hook.rerender({ org: "org-b" });
    await waitFor(() => expect(hook.result.current.data).toEqual({ current: 25 }));
    pending.resolve(response({ current: 12 }));
    await waitFor(() => expect(clients[clients.length - 1].isFetching()).toBe(0));
    expect(hook.result.current.data).toEqual({ current: 25 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).organization_id).toBe("org-b");
  });
});


describe("transport and send boundaries", () => {
  it("retries after a shared network rejection", async () => {
    const pending = pendingResponse();
    fetchMock.mockReturnValueOnce(pending.promise);
    const settled = Promise.allSettled([getInstanceStatus("instance-a", "org-a"), getInstanceStatus("instance-a", "org-a")]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    pending.reject(new TypeError("Network unavailable"));
    expect((await settled).every(result => result.status === "rejected")).toBe(true);
    fetchMock.mockResolvedValueOnce(response({ connected: true }));
    expect(await getInstanceStatus("instance-a", "org-a")).toEqual({ connected: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends two identical user messages independently", async () => {
    localStorage.setItem("selected_org_id", "org-a");
    fetchMock.mockImplementation(async () => response({ message_id: `message-${fetchMock.mock.calls.length}` }));
    const results = await Promise.all([
      sendLocation("instance-a", "5511999999999", { latitude: 1, longitude: 2 }),
      sendLocation("instance-a", "5511999999999", { latitude: 1, longitude: 2 }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results[0].message_id).not.toBe(results[1].message_id);
  });
});
