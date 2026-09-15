import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Workbook } from "exceljs";
import templates from "@/modules/analytics/lib/metrics-studio-templates.json";
import type { StudioWindow } from "@/modules/analytics/lib/metrics-studio-window";

const state = vi.hoisted(() => ({ rpc: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ organizationId: "insana", timezone: "America/Sao_Paulo" }) }));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: state.rpc,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Cervejaria Insana" }, error: null }) }) }) }),
} }));
import { useMetricsStudioReport } from "@/modules/analytics/hooks/useMetricsStudioReport";

// A mesma estrutura persistida pelo template, sem copiar sua definição.
const windows: StudioWindow[] = templates[0].layout.map((item) => ({ ...item, corte: "total", chart: "number" }));
let download: Blob | undefined;
beforeEach(() => {
  download = undefined;
  state.error.mockReset(); state.success.mockReset();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn((blob: Blob) => { download = blob; return "blob:test"; });
    static revokeObjectURL = vi.fn();
  });
  state.rpc.mockReset().mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "get_dashboard_metrics") return { error: null, data: {
      totalLeads: args.p_start_date === "2026-09-10T03:00:00.000Z" ? 8 : 5,
      vendaTotal: 1200, novosClientes: 2, dailySales: [{ day: "2026-09-10", revenue: 1200, count: 2 }],
      tempoMedioResposta: 0.0007,
    } };
    if (JSON.stringify(args.p_measure_ref).includes("negocios_na_etapa")) return { error: null, data: {
      value: null, series: [{ label: "Oportunidades", value: 139 }], anchor: "hoje",
    } };
    return { error: null, data: { value: 2949, unit: "duration_seconds", empty_reason: null } };
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("planilha da Visão Geral", () => {
  it("baixa os números reais, com período escolhido, resposta em minutos e posição atual dos funis", async () => {
    const { result } = renderHook(() => useMetricsStudioReport(windows, new Map(), {
      period: "custom", range: { from: "2026-09-10", to: "2026-09-15" },
    }));
    await act(async () => { await result.current.exportar("selected"); });
    expect(download).toBeInstanceOf(Blob);
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => { if (reader.result instanceof ArrayBuffer) resolve(reader.result); else reject(new Error("Arquivo inválido")); };
      reader.readAsArrayBuffer(download!);
    });
    const book = new Workbook();
    await book.xlsx.load(Buffer.from(buffer));
    const rows: unknown[][] = [];
    book.getWorksheet("Resumo")!.eachRow((row) => { rows.push([row.getCell(1).value, row.getCell(3).value]); });
    expect(rows).toContainEqual(["Leads novos", 8]);
    expect(rows).toContainEqual(["Resposta da equipe (minutos)", 49.15]);
    expect(book.getWorksheet("Negócios por funil")!.getCell("B2").value).toBe(139);
    expect(book.getWorksheet("Receita diária")!.getCell("B2").value).toBe(1200);
    expect(JSON.stringify(rows)).not.toContain("Painel vazio");
    expect(state.rpc).toHaveBeenCalledWith("get_dashboard_metrics", expect.objectContaining({
      p_start_date: "2026-09-10T03:00:00.000Z", p_end_date: "2026-09-16T02:59:59.999Z", p_org_id: "insana",
    }));
    expect(state.success).toHaveBeenCalledOnce();
  });
  it("não baixa uma planilha zerada quando a consulta falha", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useMetricsStudioReport(windows, new Map()));
    await act(async () => { await result.current.exportar("month"); });
    expect(download).toBeUndefined();
    expect(state.success).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith("Não foi possível gerar o relatório");
    warn.mockRestore();
  });
});
