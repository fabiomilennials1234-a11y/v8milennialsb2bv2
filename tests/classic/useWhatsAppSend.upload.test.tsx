// Runs against classic/src through vitest.classic.config.ts.
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ sign: vi.fn(), fetch: vi.fn(), invoke: vi.fn(), confirm: vi.fn(), upsert: vi.fn(), eq: vi.fn() }));
vi.mock("@/modules/identity", () => ({ useCurrentTeamMember: () => ({ data: { organization_id: "org", id: "member" } }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/core/observability/client-error-buffer", () => ({ recordClientError: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  storage: { from: () => ({ createSignedUploadUrl: mock.sign, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.invalid/${path}` } }) }) },
  functions: { invoke: mock.invoke },
  from: () => {
    const q = {
      select: () => q, eq: (...args: unknown[]) => { mock.eq(...args); return q; }, abortSignal: () => q,
      maybeSingle: async () => ({ data: { metadata: {} }, error: null }),
      in: () => q, gte: () => q, is: () => q, order: () => q, limit: mock.confirm, upsert: mock.upsert,
    };
    return q;
  },
} }));
import { useSendWhatsAppMedia } from "@/modules/communication/hooks/chat/useWhatsAppSend";
import type { FailedMessage } from "@/modules/communication/hooks/chat/types";
const variables = { phoneNumber: "5511999999999", instanceName: "sales", instanceId: "upload-instance", mediaType: "document" as const, media: "data:application/pdf;base64,cGRm", fileName: "private.pdf" };
const failedKey = ["whatsapp_failed_messages", "org", variables.phoneNumber, variables.instanceId];
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal("fetch", mock.fetch);
  mock.sign.mockResolvedValue({ data: { signedUrl: "https://storage.invalid/signed?token=private" }, error: null });
  mock.fetch.mockResolvedValue({ ok: true });
  mock.invoke.mockResolvedValue({ data: { result: { message_id: "provider-id" } }, error: null });
  mock.confirm.mockResolvedValue({ data: [], error: null });
  mock.upsert.mockResolvedValue({ error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const hook = renderHook(useSendWhatsAppMedia, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  return { ...hook, client, close: () => { hook.unmount(); client.clear(); } };
}
it("uploads a PDF with cancellable PUT, then sends the public media URL", async () => {
  const { result, close } = setup();
  await act(async () => { await result.current.mutateAsync({ ...variables }); });
  expect(mock.sign.mock.calls[0][0]).toMatch(/^whatsapp-media\/org\//);
  expect(mock.fetch.mock.calls[0][1]).toMatchObject({ method: "PUT", headers: { "Content-Type": "application/pdf", "x-upsert": "false" } });
  expect(mock.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  expect(mock.invoke.mock.calls[0][1].body).toMatchObject({ action: "sendMedia", organization_id: "org", payload: { type: "document", number: variables.phoneNumber } });
  expect(mock.invoke.mock.calls[0][1].body.payload.file).toContain("https://storage.invalid/whatsapp-media/org/");
  close();
});
it("times out stalled storage, keeps retryable attachment and never calls provider; retry succeeds", async () => {
  mock.fetch.mockReturnValueOnce(new Promise(() => {}));
  const { result, client, close } = setup();
  await act(async () => {
    const failed = expect(result.current.mutateAsync({ ...variables })).rejects.toMatchObject({ phase: "upload", reason: "timeout" });
    await vi.advanceTimersByTimeAsync(60_000); await failed;
  });
  expect(mock.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(mock.invoke).not.toHaveBeenCalled();
  expect(client.getQueryData<FailedMessage[]>(failedKey)?.[0]).toMatchObject({ mediaUrl: variables.media, retry_attempt: 0 });
  await act(async () => { await result.current.mutateAsync({ ...variables }); });
  expect(mock.invoke).toHaveBeenCalledOnce();
  expect(client.getQueryData<FailedMessage[]>(failedKey)).toHaveLength(0);
  close();
});
it("does not PUT or send when signing only resolves after its deadline", async () => {
  let resolve!: (value: unknown) => void;
  mock.sign.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { result, close } = setup();
  await act(async () => {
    const outcome = result.current.mutateAsync({ ...variables }).catch(error => error);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await outcome).toMatchObject({ phase: "upload", reason: "timeout" });
    resolve({ data: { signedUrl: "https://storage.invalid/late" }, error: null });
    await Promise.resolve();
  });
  expect(mock.fetch).not.toHaveBeenCalled(); expect(mock.invoke).not.toHaveBeenCalled();
  close();
});
it("repeated send after ambiguous provider failure only verifies delivery, without a new upload or POST", async () => {
  mock.invoke.mockReturnValueOnce(new Promise(() => {}));
  const { result, client, close } = setup();
  await act(async () => {
    const outcome = result.current.mutateAsync({ ...variables }).catch(error => error);
    await vi.advanceTimersByTimeAsync(91_000);
    expect(await outcome).toMatchObject({ retryAttempts: 10 });
  });
  await act(async () => { await expect(result.current.mutateAsync({ ...variables })).rejects.toMatchObject({ retryAttempts: 10 }); });
  expect(mock.sign).toHaveBeenCalledOnce(); expect(mock.invoke).toHaveBeenCalledOnce();
  expect(client.getQueryData<FailedMessage[]>(failedKey)).toHaveLength(1);
  mock.confirm.mockResolvedValue({ data: [{ message_id: "confirmed-id" }], error: null });
  await act(async () => { await result.current.mutateAsync({ ...variables }); });
  expect(mock.sign).toHaveBeenCalledOnce(); expect(mock.invoke).toHaveBeenCalledOnce();
  expect(mock.eq).toHaveBeenCalledWith("organization_id", "org");
  expect(mock.eq).toHaveBeenCalledWith("instance_id", variables.instanceId);
  expect(client.getQueryData<FailedMessage[]>(failedKey)).toHaveLength(0);
  close();
});
it.each([401, 403, 429])("definite provider rejection %s preserves its explanation and permits a corrected attempt", async status => {
  const error = { message: "sem acesso", context: { status, json: async () => ({ error: status === 429 ? "rate limit" : "Você não tem permissão nesta conexão." }) } };
  mock.invoke.mockResolvedValue({ data: null, error });
  const { result, close } = setup();
  await act(async () => {
    const outcome = result.current.mutateAsync({ ...variables }).catch(error => error);
    await vi.advanceTimersByTimeAsync(31_000);
    expect((await outcome).message).toContain(status === 429 ? "Aguarde" : "permissão");
  });
  expect(mock.invoke).toHaveBeenCalledTimes(status === 429 ? 10 : 1);
  mock.invoke.mockResolvedValue({ data: { result: { message_id: "corrected" } }, error: null });
  await act(async () => { await result.current.mutateAsync({ ...variables }); });
  expect(mock.sign).toHaveBeenCalledTimes(2);
  expect(mock.invoke).toHaveBeenCalledTimes(status === 429 ? 11 : 2);
  close();
});
it("denied storage signing explains access problem without starting PUT or provider send", async () => {
  mock.sign.mockResolvedValue({ data: null, error: { statusCode: "403", message: "private transport details" } });
  const { result, close } = setup();
  await act(async () => { await expect(result.current.mutateAsync({ ...variables })).rejects.toMatchObject({ reason: "forbidden" }); });
  expect(mock.fetch).not.toHaveBeenCalled(); expect(mock.invoke).not.toHaveBeenCalled();
  close();
});
