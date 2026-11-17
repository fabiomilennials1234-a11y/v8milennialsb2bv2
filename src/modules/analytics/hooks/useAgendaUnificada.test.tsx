import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventos: { data: [] as unknown[], isLoading: false, isError: false, refetch: vi.fn() },
  contatos: { data: [] as unknown[], isLoading: false, isError: false, refetch: vi.fn() },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ organizationId: "org1", timezone: "America/Sao_Paulo" }) }));
vi.mock("@/modules/engagement", () => ({ useAgendaEvents: () => mocks.eventos }));
vi.mock("@/modules/analytics/hooks/useAgendaContatos", () => ({ useAgendaContatos: () => mocks.contatos }));
vi.mock("@/modules/analytics/hooks/useComandoScope", () => ({ useComandoScope: () => ({ meuTeamMemberId: "tm1", meuUserId: "u1" }) }));
vi.mock("@/modules/analytics/hooks/useEscopoAgenda", () => ({ useEscopoAgenda: () => ({ somenteMeus: false }) }));

import { useAgendaUnificada } from "./useAgendaUnificada";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

const hojeIso = () => new Date().toISOString();
const reuniao = { id: "r1", source: "meeting", title: "Reunião", description: null, start_at: hojeIso(), event_type: "meeting", status: "scheduled", lead_id: null, lead_name: "Cliente", lead_company: null, created_by: null, creator_name: null };

describe("useAgendaUnificada — falha parcial", () => {
  beforeEach(() => {
    mocks.eventos = { data: [reuniao], isLoading: false, isError: false, refetch: vi.fn() };
    mocks.contatos = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
  });

  it("tudo certo: sem erro e sem aviso", () => {
    const { result } = renderHook(() => useAgendaUnificada("mes"), { wrapper });
    expect(result.current.isError).toBe(false);
    expect(result.current.indisponiveis).toEqual({ eventos: false, contatos: false });
    expect(result.current.itens).toHaveLength(1);
  });

  it("contatos falham (ex.: master fora da org): a reunião continua na lista e vem o aviso", () => {
    mocks.contatos = { data: undefined as never, isLoading: false, isError: true, refetch: vi.fn() };
    const { result } = renderHook(() => useAgendaUnificada("mes"), { wrapper });
    expect(result.current.isError).toBe(false);
    expect(result.current.indisponiveis).toEqual({ eventos: false, contatos: true });
    expect(result.current.itens).toHaveLength(1);
  });

  it("eventos falham: os contatos continuam e vem o aviso", () => {
    mocks.eventos = { data: undefined as never, isLoading: false, isError: true, refetch: vi.fn() };
    const { result } = renderHook(() => useAgendaUnificada("mes"), { wrapper });
    expect(result.current.isError).toBe(false);
    expect(result.current.indisponiveis).toEqual({ eventos: true, contatos: false });
  });

  it("as duas falham: aí sim é erro", () => {
    mocks.eventos = { data: undefined as never, isLoading: false, isError: true, refetch: vi.fn() };
    mocks.contatos = { data: undefined as never, isLoading: false, isError: true, refetch: vi.fn() };
    const { result } = renderHook(() => useAgendaUnificada("mes"), { wrapper });
    expect(result.current.isError).toBe(true);
    expect(result.current.indisponiveis).toEqual({ eventos: false, contatos: false });
  });
});
