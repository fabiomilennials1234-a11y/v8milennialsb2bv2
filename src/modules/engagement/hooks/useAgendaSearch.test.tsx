/**
 * Contrato do `useAgendaSearch` (busca global da Agenda, sem janela de datas):
 * - só consulta com >= 2 caracteres, depois de 300 ms de silêncio;
 * - chama `search_agenda_events` com org, termo aparado e limite;
 * - enquanto digita, `isPending` é verdadeiro e `events` NÃO mostra o resultado
 *   do termo anterior;
 * - erro do banco vira `isError`; função ausente (PGRST202) vira `isUnavailable`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createWrapper } from "../../../../tests/helpers/hook-test-utils";

const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));

import {
  useAgendaSearch,
  AGENDA_SEARCH_DEBOUNCE_MS,
  AGENDA_SEARCH_LIMIT,
} from "./useAgendaSearch";

const evento = (id: string) => ({
  id,
  source: "meeting",
  title: "Reunião",
  description: null,
  start_at: "2026-10-01T12:00:00Z",
  end_at: "2026-10-01T13:00:00Z",
  all_day: false,
  event_type: "meeting",
  status: "scheduled",
  lead_id: "lead-1",
  lead_name: "Padaria Estrela",
  lead_company: null,
  created_by: null,
  creator_name: null,
  location: null,
  meet_link: null,
  color: null,
  google_event_id: null,
});

describe("useAgendaSearch", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("não consulta com menos de 2 caracteres", async () => {
    const { result } = renderHook(() => useAgendaSearch("e"), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENDA_SEARCH_DEBOUNCE_MS + 50);
    });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(result.current.isActive).toBe(false);
    expect(result.current.isPending).toBe(false);
    expect(result.current.events).toEqual([]);
  });

  it("espera o debounce, aparando o termo, e chama a RPC com org, termo e limite", async () => {
    rpcMock.mockResolvedValue({ data: [evento("e1")], error: null });
    // A caixa nasce vazia e o termo CRESCE — é o uso real (o `useDebounce`
    // devolve o valor inicial sem esperar).
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useAgendaSearch(q),
      { wrapper: createWrapper(), initialProps: { q: "" } },
    );
    rerender({ q: "  estrela  " });

    // Antes do debounce: pendente, sem chamada.
    expect(result.current.isActive).toBe(true);
    expect(result.current.isPending).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENDA_SEARCH_DEBOUNCE_MS + 10);
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("search_agenda_events", {
      p_organization_id: "org-1",
      p_query: "estrela",
      p_limit: AGENDA_SEARCH_LIMIT,
    });
    expect(result.current.events.map((e) => e.id)).toEqual(["e1"]);
    expect(result.current.isError).toBe(false);
  });

  it("digitando de novo, não mostra o resultado do termo anterior", async () => {
    rpcMock.mockResolvedValueOnce({ data: [evento("e1")], error: null });
    rpcMock.mockResolvedValueOnce({ data: [evento("e2")], error: null });

    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useAgendaSearch(q),
      { wrapper: createWrapper(), initialProps: { q: "estrela" } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENDA_SEARCH_DEBOUNCE_MS + 10);
    });
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    rerender({ q: "estrelas" });
    expect(result.current.isPending).toBe(true);
    expect(result.current.events).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENDA_SEARCH_DEBOUNCE_MS + 10);
    });
    await waitFor(() =>
      expect(result.current.events.map((e) => e.id)).toEqual(["e2"]),
    );
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it("rajada de teclas gera UMA consulta, do último termo", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const { rerender } = renderHook(
      ({ q }: { q: string }) => useAgendaSearch(q),
      { wrapper: createWrapper(), initialProps: { q: "" } },
    );
    rerender({ q: "es" });
    for (const q of ["est", "estr", "estre"]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      rerender({ q });
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENDA_SEARCH_DEBOUNCE_MS + 10);
    });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_query: "estre" });
  });

  it("erro do banco vira isError (e não lista vazia)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "forbidden: org not accessible" },
    });
    const { result } = renderHook(() => useAgendaSearch("estrela"), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENDA_SEARCH_DEBOUNCE_MS + 10);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isUnavailable).toBe(false);
    expect(result.current.events).toEqual([]);
  });

  it("função ausente (PGRST202) vira isUnavailable, sem repetir a chamada", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.search_agenda_events",
      },
    });
    const { result } = renderHook(() => useAgendaSearch("estrela"), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENDA_SEARCH_DEBOUNCE_MS + 10);
    });
    await waitFor(() => expect(result.current.isUnavailable).toBe(true));
    expect(result.current.isError).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
