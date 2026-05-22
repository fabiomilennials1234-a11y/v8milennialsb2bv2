import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSDRPerformance } from "@/hooks/useSDRPerformance";
import type { TVPeriodRange } from "@/lib/tv-periods";

const now = new Date(2026, 4, 22, 12, 0, 0);
const inRangeDate = new Date(2026, 4, 20).toISOString();
const outRangeDate = new Date(2026, 2, 10).toISOString();

const mockSDRs = [
  { id: "s1", name: "SDR Um", metric_type: "meetings", is_active: true },
  { id: "s2", name: "SDR Dois", metric_type: "meetings", is_active: true },
  { id: "s3", name: "Closer X", metric_type: "sales", is_active: true },
];

const mockConfirmacoes = [
  // s1: 2 marcadas in-range, 1 compareceu, 1 no-show
  { id: "c1", status: "reuniao_marcada", metrics_period_at: inRangeDate, meeting_date: outRangeDate, pre_sale_responsible_id: "s1" },
  { id: "c2", status: "compareceu", metrics_period_at: outRangeDate, meeting_date: inRangeDate, pre_sale_responsible_id: "s1" },
  { id: "c3", status: "remarcar", metrics_period_at: outRangeDate, meeting_date: inRangeDate, pre_sale_responsible_id: "s1" },
  { id: "c4", status: "compareceu", metrics_period_at: inRangeDate, meeting_date: inRangeDate, pre_sale_responsible_id: "s1" },
  // s2: 1 marcada in-range
  { id: "c5", status: "reuniao_marcada", metrics_period_at: inRangeDate, meeting_date: inRangeDate, pre_sale_responsible_id: "s2" },
  // outside range — não conta
  { id: "c6", status: "compareceu", metrics_period_at: outRangeDate, meeting_date: outRangeDate, pre_sale_responsible_id: "s1" },
  // legacy fallback: sdr_id em vez de pre_sale_responsible_id, marcada fora do range
  { id: "c7", status: "compareceu", metrics_period_at: outRangeDate, meeting_date: inRangeDate, sdr_id: "s2" },
];

vi.mock("@/hooks/usePipeConfirmacao", () => ({
  usePipeConfirmacao: () => ({ data: mockConfirmacoes }),
}));

vi.mock("@/hooks/useTeamMembers", () => ({
  useTeamMembers: () => ({ data: mockSDRs }),
}));

vi.mock("@/hooks/useAvatarMap", () => ({
  useAvatarMap: () => new Map([["s1", "url-s1"]]),
}));

describe("useSDRPerformance", () => {
  const range: TVPeriodRange = {
    start: new Date(2026, 4, 15, 0, 0, 0),
    end: new Date(2026, 4, 22, 23, 59, 59),
  };

  it("agrega métricas por SDR com crédito dual (pre_sale_responsible_id ?? sdr_id)", () => {
    const { result } = renderHook(() => useSDRPerformance(range));
    const data = result.current;

    expect(data.totals.marcadas).toBe(3); // c1, c4, c5
    expect(data.totals.comparecidas).toBe(3); // c2, c4, c7
    expect(data.totals.noShow).toBe(1); // c3
  });

  it("calcula no-show rate corretamente", () => {
    const { result } = renderHook(() => useSDRPerformance(range));
    // 1 no-show / (1 + 3) = 25%
    expect(result.current.totals.noShowRate).toBeCloseTo(25, 1);
  });

  it("ordena bySDR por marcadas desc", () => {
    const { result } = renderHook(() => useSDRPerformance(range));
    const s1 = result.current.bySDR.find((s) => s.id === "s1");
    const s2 = result.current.bySDR.find((s) => s.id === "s2");
    expect(s1?.marcadas).toBe(2);
    expect(s2?.marcadas).toBe(1);
    expect(result.current.bySDR[0].id).toBe("s1");
  });

  it("ignora closers (metric_type=sales)", () => {
    const { result } = renderHook(() => useSDRPerformance(range));
    expect(result.current.bySDR.find((s) => s.id === "s3")).toBeUndefined();
  });
});
