import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePreferenciasDeAviso } from "./usePreferenciasDeAviso";

const mocks = vi.hoisted(() => ({ upsert: vi.fn() }));
vi.mock("@/modules/identity", () => ({
  useAuth: () => ({ user: { id: "user-a" } }),
  useOrganization: () => ({ organizationId: "org-a", isReady: true }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }), upsert: mocks.upsert };
  return query;
} } }));
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  mocks.upsert.mockReset().mockResolvedValue({ error: null });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });

it("serializa alterações para não perder a preferência salva por outro controle", async () => {
  const { result } = renderHook(() => usePreferenciasDeAviso(), { wrapper });
  await waitFor(() => expect(result.current.carregando).toBe(false));
  await act(async () => {
    await Promise.all([result.current.salvar({ sound_enabled: false }), result.current.salvar({ volume: 20 })]);
  });
  await waitFor(() => expect(result.current.preferencias).toMatchObject({ sound_enabled: false, volume: 20 }));
  expect(mocks.upsert.mock.lastCall![0]).toMatchObject({ user_id: "user-a", organization_id: "org-a", sound_enabled: false, volume: 20 });
});

it("mostra salvando durante a escrita e desfaz o estado otimista se o banco recusar", async () => {
  const { result } = renderHook(() => usePreferenciasDeAviso(), { wrapper });
  await waitFor(() => expect(result.current.carregando).toBe(false));
  let finish!: (result: { error: { message: string } }) => void;
  mocks.upsert.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  let save!: Promise<unknown>;
  act(() => { save = result.current.salvar({ sound_enabled: false }).catch(error => error); });
  await waitFor(() => expect(result.current.salvando).toBe(true));
  expect(result.current.preferencias.sound_enabled).toBe(false);
  await act(async () => { finish({ error: { message: "write denied" } }); await save; });
  await waitFor(() => expect(result.current.salvando).toBe(false));
  expect(result.current.preferencias.sound_enabled).toBe(true);
});
