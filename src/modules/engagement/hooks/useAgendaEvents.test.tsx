/**
 * Contrato do `useAgendaEvents` frente ao teto de 1.000 linhas do PostgREST:
 * - janela com < 1000 linhas: UMA chamada;
 * - janela que estoura: divide ao meio, junta, deduplica e ordena;
 * - piso de 1 hora: sem loop infinito, emite `console.warn`;
 * - função ausente (PGRST202) cai na RPC base; 42P01 cai no fallback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../../../../tests/helpers/hook-test-utils";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));

import {
  useAgendaEvents,
  fetchAgendaEventsAdaptativo,
  type AgendaEvent,
} from "./useAgendaEvents";

const HORA = 3_600_000;
const INICIO = new Date("2026-09-01T00:00:00Z");
const FIM = new Date("2026-12-01T00:00:00Z");

function evento(
  id: string,
  startMs: number,
  source: AgendaEvent["source"] = "meeting",
): AgendaEvent {
  return {
    id,
    source,
    title: "Compromisso",
    description: null,
    start_at: new Date(startMs).toISOString(),
    end_at: null,
    all_day: false,
    event_type: "meeting",
    status: "scheduled",
    lead_id: null,
    lead_name: null,
    lead_company: null,
    created_by: null,
    creator_name: null,
    location: null,
    meet_link: null,
    color: null,
    google_event_id: null,
  };
}

/** Fonte simulada: aplica o corte de 1000 linhas, ordenando só por start_at. */
function fonteComTeto(todos: AgendaEvent[]) {
  return vi.fn(async (inicio: Date, fim: Date) => {
    const dentro = todos
      .filter((e) => {
        const t = new Date(e.start_at).getTime();
        return t >= inicio.getTime() && t < fim.getTime();
      })
      .sort(
        (a, b) =>
          new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
      );
    return dentro.slice(0, 1000);
  });
}

describe("fetchAgendaEventsAdaptativo", () => {
  it("uma única chamada quando a janela tem < 1000 linhas", async () => {
    const dados = [
      evento("b", INICIO.getTime() + 2 * HORA),
      evento("a", INICIO.getTime() + HORA),
    ];
    const fetchWindow = fonteComTeto(dados);
    const out = await fetchAgendaEventsAdaptativo(fetchWindow, INICIO, FIM);
    expect(fetchWindow).toHaveBeenCalledTimes(1);
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("divide a janela que estoura e não perde nenhum evento (~1500)", async () => {
    const span = FIM.getTime() - INICIO.getTime();
    const todos = Array.from({ length: 1498 }, (_, i) =>
      evento(`e${i}`, INICIO.getTime() + Math.floor((span * i) / 1498)),
    );
    // Dezenas de eventos no MESMO horário (o caso que quebra range()).
    for (let i = 0; i < 40; i++) {
      todos.push(
        evento(
          `mesmo${i}`,
          INICIO.getTime() + span / 2 - 5 * HORA,
          "scheduled_message",
        ),
      );
    }
    const fetchWindow = fonteComTeto(todos);
    const out = await fetchAgendaEventsAdaptativo(fetchWindow, INICIO, FIM);

    expect(fetchWindow.mock.calls.length).toBeGreaterThan(1);
    expect(out).toHaveLength(todos.length);
    expect(new Set(out.map((e) => `${e.source}:${e.id}`))).toEqual(
      new Set(todos.map((e) => `${e.source}:${e.id}`)),
    );
    const tempos = out.map((e) => new Date(e.start_at).getTime());
    expect([...tempos].sort((a, b) => a - b)).toEqual(tempos);
  });

  it("evento duplicado na fronteira aparece 1x", async () => {
    const meio = INICIO.getTime() + (FIM.getTime() - INICIO.getTime()) / 2;
    const cruza = evento("cruza", meio - HORA);
    const cheia = Array.from({ length: 1000 }, (_, i) =>
      evento(`x${i}`, INICIO.getTime() + i),
    );
    const fetchWindow = vi.fn(async (inicio: Date, fim: Date) => {
      if (
        inicio.getTime() === INICIO.getTime() &&
        fim.getTime() === FIM.getTime()
      ) {
        return cheia;
      }
      return [cruza]; // as duas metades devolvem o mesmo evento
    });
    const out = await fetchAgendaEventsAdaptativo(fetchWindow, INICIO, FIM);
    expect(out.filter((e) => e.id === "cruza")).toHaveLength(1);
    expect(fetchWindow).toHaveBeenCalledTimes(3);
  });

  it("desempata por source e id quando o start_at é igual", async () => {
    const t = INICIO.getTime() + HORA;
    const fetchWindow = vi.fn(async () => [
      evento("2", t, "meeting"),
      evento("1", t, "meeting"),
      evento("0", t, "follow_up"),
    ]);
    const out = await fetchAgendaEventsAdaptativo(fetchWindow, INICIO, FIM);
    expect(out.map((e) => `${e.source}:${e.id}`)).toEqual([
      "follow_up:0",
      "meeting:1",
      "meeting:2",
    ]);
  });

  it("respeita o piso de 1 hora: termina e emite warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sempreCheia = vi.fn(async (inicio: Date) =>
      Array.from({ length: 1000 }, (_, i) =>
        evento(`${inicio.getTime()}-${i}`, inicio.getTime()),
      ),
    );
    const fim = new Date(INICIO.getTime() + 8 * HORA);
    const out = await fetchAgendaEventsAdaptativo(sempreCheia, INICIO, fim);
    expect(sempreCheia.mock.calls.length).toBeLessThanOrEqual(15);
    expect(out.length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("2026-09-01T");
    warn.mockRestore();
  });
});

describe("useAgendaEvents", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("busca pela RPC com recorte em uma chamada", async () => {
    rpcMock.mockResolvedValue({
      data: [evento("a", INICIO.getTime() + HORA)],
      error: null,
    });
    const { result } = renderHook(() => useAgendaEvents(INICIO, FIM), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][0]).toBe("get_agenda_events_scoped");
    expect(rpcMock.mock.calls[0][1]).toEqual({
      p_organization_id: "org-1",
      p_start: INICIO.toISOString(),
      p_end: FIM.toISOString(),
    });
    expect(result.current.data).toHaveLength(1);
  });

  it("função ausente (PGRST202) continua caindo em get_agenda_events", async () => {
    rpcMock.mockImplementation(async (name: string) =>
      name === "get_agenda_events_scoped"
        ? {
            data: null,
            error: { code: "PGRST202", message: "Could not find the function" },
          }
        : { data: [evento("a", INICIO.getTime() + HORA)], error: null },
    );
    const { result } = renderHook(() => useAgendaEvents(INICIO, FIM), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual([
      "get_agenda_events_scoped",
      "get_agenda_events",
    ]);
    expect(result.current.data).toHaveLength(1);
  });

  it("42P01 continua indo para o fallback por tabelas", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "42P01", message: "relation does not exist" },
    });
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "not", "gt", "gte", "lt"]) {
      builder[m] = () => builder;
    }
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: [], error: null });
    fromMock.mockReturnValue(builder);
    const { result } = renderHook(() => useAgendaEvents(INICIO, FIM), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fromMock).toHaveBeenCalled();
    expect(result.current.data).toEqual([]);
  });

  it("outro erro do banco vira isError", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "boom" },
    });
    const { result } = renderHook(() => useAgendaEvents(INICIO, FIM), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
