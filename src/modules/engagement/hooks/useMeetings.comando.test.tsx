import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Cadeia mínima do PostgREST para o UPDATE (`.update().eq().eq().select().single()`)
// e para o DELETE (`.delete().eq().eq()` → { error, count }).
const linha = { id: "m1", status: "completed" };
vi.mock("@/integrations/supabase/client", () => {
  const fim = { select: () => ({ single: async () => ({ data: linha, error: null }) }) };
  const apagado = Promise.resolve({ error: null, count: 1 });
  return {
    supabase: {
      from: () => ({
        update: () => ({ eq: () => ({ eq: () => fim }) }),
        delete: () => ({ eq: () => ({ eq: () => apagado }) }),
      }),
    },
  };
});
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-cj" }),
  useAuth: () => ({ user: { id: "u1" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/shared/errors", () => ({ notifyError: vi.fn() }));

import { useDeleteMeeting, useUpdateMeeting } from "./useMeetings";

function montar<T>(hook: () => T) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidar = vi.spyOn(qc, "invalidateQueries");
  const { result } = renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
  const chaves = () => invalidar.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
  return { result, chaves };
}

// As leituras do Comando que não passam por `agenda-events`: o "Reuniões hoje"
// (`useComandoAgenda`) e os atrasados do "Hoje" da Agenda (`useAgendaUnificada`).
const DO_COMANDO = [JSON.stringify(["comando", "agenda"]), JSON.stringify(["comando", "agenda-unificada", "atrasados"])];

describe("gravar reunião recarrega o Comando", () => {
  it("marcar compareceu invalida o 'Reuniões hoje' e os atrasados da Agenda", async () => {
    const { result, chaves } = montar(() => useUpdateMeeting());
    result.current.mutate({ id: "m1", status: "completed" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(chaves()).toEqual(expect.arrayContaining([JSON.stringify(["agenda-events"]), ...DO_COMANDO]));
  });

  it("excluir também", async () => {
    const { result, chaves } = montar(() => useDeleteMeeting());
    result.current.mutate("m1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(chaves()).toEqual(expect.arrayContaining(DO_COMANDO));
  });
});
