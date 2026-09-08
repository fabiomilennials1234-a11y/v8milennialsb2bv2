import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { metadata: {} } }) }) }),
      upsert: () => Promise.resolve({ error: null }),
    }),
  },
}));
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { organization_id: "org", id: "member" } }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { useSendWhatsAppMessage } from "./useWhatsAppSend";
import type { FailedMessage } from "./types";

beforeEach(() => invoke.mockReset());
afterEach(() => vi.useRealTimers());

it("sends to the original Business landline without inserting a ninth digit", async () => {
  invoke.mockResolvedValue({ data: { result: { message_id: "provider-id" } }, error: null });
  const client = new QueryClient();
  const { result, unmount } = renderHook(useSendWhatsAppMessage, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await result.current.mutateAsync({ phoneNumber: "555134073827", message: "quotation", instanceName: "sales", instanceId: "instance" });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0][1].body.payload.number).toBe("555134073827");
  unmount();
  client.clear();
});

it("keeps one failed text bubble across repeated attempts and clears it after success", async () => {
  vi.useFakeTimers();
  invoke.mockResolvedValue({ data: null, error: new Error("Provider unavailable") });
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const { result, unmount } = renderHook(useSendWhatsAppMessage, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  const variables = { phoneNumber: "555134073827", message: "quotation", instanceName: "sales", instanceId: "instance" };
  const failedKey = ["whatsapp_failed_messages", "org", variables.phoneNumber, variables.instanceId];
  for (let attempt = 0; attempt < 7; attempt++) {
    await act(async () => {
      const failed = expect(result.current.mutateAsync({ ...variables })).rejects.toThrow("Falha no envio");
      await vi.advanceTimersByTimeAsync(31_000);
      await failed;
    });
  }
  expect(client.getQueryData<FailedMessage[]>(failedKey)).toHaveLength(1);
  await act(async () => {
    const different = expect(result.current.mutateAsync({ ...variables, message: "different text" })).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(31_000);
    await different;
  });
  expect(client.getQueryData<FailedMessage[]>(failedKey)).toHaveLength(2);
  invoke.mockResolvedValue({ data: { result: { message_id: "provider-id" } }, error: null });
  await act(async () => { await result.current.mutateAsync(variables); });
  expect(client.getQueryData<FailedMessage[]>(failedKey)?.map((m) => m.message)).toEqual(["different text"]);
  unmount();
  client.clear();
});
