import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEditarValorProposta } from "@/modules/leads/components/deal-card/useItensDoNegocio";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), notify: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/shared/errors", async importOriginal => ({ ...await importOriginal<typeof import("@/shared/errors")>(), notifyError: mocks.notify }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it.each([{ code: "PT409", invalidates: true }, { code: "42501", invalidates: false }])("$code só recarrega a ficha se houve conflito", async ({ code, invalidates }) => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const key = ["deal-card-extras", "entry", "pipeline", "proposta"];
  client.setQueryData(key, { version: "v1" });
  mocks.rpc.mockResolvedValue({ error: { code, message: "test error", details: null, hint: null } });
  const { result } = renderHook(() => useEditarValorProposta("entry"), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await act(async () => { await expect(result.current.mutateAsync({ valor: 150, expectedUpdatedAt: "v1" })).rejects.toMatchObject({ code }); });
  expect(client.getQueryState(key)?.isInvalidated).toBe(invalidates);
  expect(mocks.notify).toHaveBeenCalled();
  client.clear();
});
