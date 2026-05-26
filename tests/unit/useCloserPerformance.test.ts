import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCloserPerformance } from "@/hooks/useCloserPerformance";
import type { TVPeriodRange } from "@/lib/tv-periods";

const inRangeDate = new Date(2026, 4, 20).toISOString();
const outRangeDate = new Date(2026, 2, 10).toISOString();

const mockClosers = [
  { id: "cl1", name: "Closer A", metric_type: "sales", is_active: true },
  { id: "cl2", name: "Closer B", metric_type: "sales", is_active: true },
  { id: "sdr1", name: "SDR X", metric_type: "meetings", is_active: true },
];

const mockPropostas = [
  // cl1: 2 propostas in range, 1 venda 10k
  { id: "p1", status: "vendido", metrics_period_at: inRangeDate, created_at: inRangeDate, closed_at: inRangeDate, sale_value: 10000, sale_responsible_id: "cl1" },
  { id: "p2", status: "proposta_enviada", metrics_period_at: inRangeDate, created_at: inRangeDate, sale_value: 0, sale_responsible_id: "cl1" },
  // cl2: 1 proposta, 1 venda 30k
  { id: "p3", status: "vendido", metrics_period_at: inRangeDate, created_at: inRangeDate, closed_at: inRangeDate, sale_value: 30000, sale_responsible_id: "cl2" },
  // fora do range
  { id: "p4", status: "vendido", metrics_period_at: outRangeDate, created_at: outRangeDate, closed_at: outRangeDate, sale_value: 50000, sale_responsible_id: "cl1" },
  // legacy: closer_id sem sale_responsible_id
  { id: "p5", status: "proposta_enviada", metrics_period_at: inRangeDate, created_at: inRangeDate, closer_id: "cl2" },
];

const mockConfirmacoes = [
  { id: "c1", status: "compareceu", meeting_date: inRangeDate, sale_responsible_id: "cl1" },
  { id: "c2", status: "compareceu", meeting_date: inRangeDate, sale_responsible_id: "cl2" },
  { id: "c3", status: "compareceu", meeting_date: inRangeDate, sale_responsible_id: "cl2" },
  { id: "c4", status: "remarcar", meeting_date: inRangeDate, sale_responsible_id: "cl1" }, // não compareceu
  { id: "c5", status: "compareceu", meeting_date: outRangeDate, sale_responsible_id: "cl1" }, // fora
];

vi.mock("@/hooks/usePipePropostas", () => ({ usePipePropostas: () => ({ data: mockPropostas }) }));
vi.mock("@/hooks/usePipeConfirmacao", () => ({ usePipeConfirmacao: () => ({ data: mockConfirmacoes }) }));
vi.mock("@/modules/identity/hooks/useTeamMembers", () => ({ useTeamMembers: () => ({ data: mockClosers }) }));
vi.mock("@/hooks/useAvatarMap", () => ({ useAvatarMap: () => new Map() }));

describe("useCloserPerformance", () => {
  const range: TVPeriodRange = {
    start: new Date(2026, 4, 15, 0, 0, 0),
    end: new Date(2026, 4, 22, 23, 59, 59),
  };

  it("calcula vendas, valor, ticket, conversão por closer", () => {
    const { result } = renderHook(() => useCloserPerformance(range));
    const cl1 = result.current.byCloser.find((c) => c.id === "cl1")!;
    const cl2 = result.current.byCloser.find((c) => c.id === "cl2")!;

    expect(cl1.vendas).toBe(1);
    expect(cl1.vendasValor).toBe(10000);
    expect(cl1.propostas).toBe(2);
    expect(cl1.ticketMedio).toBe(10000);
    expect(cl1.conversao).toBe(50);

    expect(cl2.vendas).toBe(1);
    expect(cl2.vendasValor).toBe(30000);
    expect(cl2.propostas).toBe(2); // p3 + p5 (legacy closer_id)
    expect(cl2.ticketMedio).toBe(30000);
    expect(cl2.conversao).toBe(50);
  });

  it("reuniões realizadas só conta compareceu", () => {
    const { result } = renderHook(() => useCloserPerformance(range));
    const cl1 = result.current.byCloser.find((c) => c.id === "cl1")!;
    const cl2 = result.current.byCloser.find((c) => c.id === "cl2")!;
    expect(cl1.reunioesRealizadas).toBe(1);
    expect(cl2.reunioesRealizadas).toBe(2);
  });

  it("ordena por vendasValor desc; topCloser = maior valor", () => {
    const { result } = renderHook(() => useCloserPerformance(range));
    expect(result.current.byCloser[0].id).toBe("cl2");
    expect(result.current.topCloserId).toBe("cl2");
  });

  it("ignora SDRs", () => {
    const { result } = renderHook(() => useCloserPerformance(range));
    expect(result.current.byCloser.find((c) => c.id === "sdr1")).toBeUndefined();
  });

  it("totals batem com soma dos closers", () => {
    const { result } = renderHook(() => useCloserPerformance(range));
    const t = result.current.totals;
    expect(t.vendas).toBe(2);
    expect(t.vendasValor).toBe(40000);
    expect(t.ticketMedio).toBe(20000);
  });
});
