import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Aviso } from "../lib/aviso-stream";
import { useAvisos } from "./useAvisos";

const mocks = vi.hoisted(() => ({
  rows: [] as Aviso[], org: "org-a", user: "user-a", tocar: vi.fn(), cartao: vi.fn(),
  realtime: vi.fn(),
}));
vi.mock("@/modules/identity", () => ({
  useAuth: () => ({ user: { id: mocks.user } }),
  useOrganization: () => ({ organizationId: mocks.org, isReady: true }),
}));
vi.mock("./usePreferenciasDeAviso", async () => {
  const { resolverPreferencias } = await import("../lib/preferencias-de-aviso");
  return { usePreferenciasDeAviso: () => ({ preferencias: resolverPreferencias(null) }) };
});
vi.mock("./usePresenca", () => ({ usePresenca: vi.fn() }));
vi.mock("@/shared/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: (options: unknown) => { mocks.realtime(options); return { state: "polling" }; },
}));
vi.mock("../lib/motor-de-som", () => ({ motorDeSom: {
  tocar: mocks.tocar, destravarNoPrimeiroGesto: () => () => {},
} }));
vi.mock("../lib/cartoes-store", () => ({ mostrarCartao: mocks.cartao, reiniciarCartoes: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => {
  const filters: Record<string, string> = {};
  const query = {
    select: () => query,
    eq: (key: string, value: string) => { filters[key] = value; return query; },
    order: () => query, limit: () => query,
    then: (resolve: (result: { data: Aviso[]; error: null }) => unknown) => Promise.resolve(resolve({
      data: mocks.rows.filter(row => Object.entries(filters).every(([key, value]) => row[key as keyof Aviso] === value)), error: null,
    })),
  };
  return query;
} } }));

const aviso = (id: string, changes: Partial<Aviso> = {}): Aviso => ({
  id, organization_id: "org-a", user_id: "user-a", type: "lead_message", title: "Novo aviso",
  description: null, link: "/agenda", lead_id: null, entity_id: null, group_key: id,
  event_count: 1, last_event_at: new Date().toISOString(), created_at: new Date().toISOString(),
  read_at: null, ...changes,
});
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  vi.clearAllMocks(); mocks.rows = []; mocks.org = "org-a"; mocks.user = "user-a";
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });
const atualizar = () => act(async () => { await client.invalidateQueries({ queryKey: ["avisos"] }); });

describe("entrega de avisos", () => {
  it("recupera som e mensagem por consulta quando o realtime cai, sem repetir histórico ou leitura", async () => {
    mocks.rows = [aviso("antigo")];
    const { result } = renderHook(() => useAvisos({ entregar: true }), { wrapper });
    await waitFor(() => expect(result.current.avisos).toHaveLength(1));
    expect(mocks.tocar).not.toHaveBeenCalled();
    mocks.rows = [aviso("novo"), ...mocks.rows];
    await atualizar();
    await waitFor(() => expect(mocks.tocar).toHaveBeenCalledTimes(1));
    expect(mocks.cartao).toHaveBeenCalledTimes(1);
    await atualizar();
    mocks.rows = mocks.rows.map(row => ({ ...row, read_at: new Date().toISOString() }));
    await atualizar();
    expect(mocks.tocar).toHaveBeenCalledTimes(1);
  });

  it("tempo real e consulta entregam o mesmo aviso uma só vez", async () => {
    const { result } = renderHook(() => useAvisos({ entregar: true }), { wrapper });
    await waitFor(() => expect(result.current.carregando).toBe(false));
    const novo = aviso("novo");
    act(() => mocks.realtime.mock.lastCall![0].onEvent({ eventType: "INSERT", new: novo }));
    await waitFor(() => expect(mocks.tocar).toHaveBeenCalledTimes(1));
    mocks.rows = [novo]; await atualizar();
    expect(mocks.tocar).toHaveBeenCalledTimes(1);
  });

  it("ignora eventos de outra organização ou destinatário e não anuncia histórico ao trocar de org", async () => {
    const { result, rerender } = renderHook(() => useAvisos({ entregar: true }), { wrapper });
    await waitFor(() => expect(result.current.carregando).toBe(false));
    act(() => {
      const onEvent = mocks.realtime.mock.lastCall![0].onEvent;
      onEvent({ eventType: "INSERT", new: aviso("outra-org", { organization_id: "org-b" }) });
      onEvent({ eventType: "INSERT", new: aviso("outro-user", { user_id: "user-b" }) });
    });
    expect(mocks.tocar).not.toHaveBeenCalled();
    mocks.rows = [aviso("historico-b", { organization_id: "org-b" })]; mocks.org = "org-b";
    rerender(); await waitFor(() => expect(result.current.avisos[0]?.id).toBe("historico-b"));
    expect(mocks.tocar).not.toHaveBeenCalled();
  });

  it("os sinos de desktop e celular só leem; apenas o receptor global entrega", async () => {
    const { result } = renderHook(() => useAvisos(), { wrapper });
    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(mocks.realtime.mock.lastCall![0].enabled).toBe(false);
  });
});
