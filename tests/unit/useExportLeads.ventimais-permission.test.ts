import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VENTIMAIS_ORGANIZATION_ID } from "@/modules/leads/lib/ventimais-export";

const state = vi.hoisted(() => ({
  organizationId: "56b88e32-be6a-436e-b4e6-6e1293d21659" as string | null,
  allowed: true, isLoading: false, load: vi.fn(), from: vi.fn(),
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: state.organizationId }),
  useCanDo: () => ({ allowed: state.allowed, isLoading: state.isLoading }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: state.from } }));
vi.mock("@/modules/leads/lib/load-ventimais-export", () => ({ loadVentimaisExport: state.load }));
import { useExportLeads } from "@/modules/leads/hooks/useExportLeads";

beforeEach(() => {
  state.organizationId = VENTIMAIS_ORGANIZATION_ID;
  state.allowed = true;
  state.isLoading = false;
  state.load.mockReset();
  state.from.mockReset();
});

describe("permissão antes de exportar detalhes Ventimais", () => {
  it.each([false, true])("nega antes de buscar dados (permissão carregando: %s)", async loading => {
    state.allowed = false;
    state.isLoading = loading;
    const { result } = renderHook(() => useExportLeads());
    await expect(result.current.exportLeads({ format: "xlsx", pipelineId: "pipeline-1" })).rejects.toThrow(loading ? "Permissões ainda carregando" : "Você não tem permissão");
    expect(state.load).not.toHaveBeenCalled();
    expect(state.from).not.toHaveBeenCalled();
  });
  it("usa a organização autenticada e não cai no exportador global para um kanban vazio", async () => {
    state.load.mockResolvedValue({ entries: [] });
    const { result } = renderHook(() => useExportLeads());
    await act(async () => {
      expect(await result.current.exportLeads({ format: "xlsx", pipelineId: "pipeline-1" })).toEqual({ count: 0, unit: "negócios" });
    });
    expect(state.load).toHaveBeenCalledWith(VENTIMAIS_ORGANIZATION_ID, { format: "xlsx", pipelineId: "pipeline-1" });
    expect(state.from).not.toHaveBeenCalled();
    expect(result.current.isExporting).toBe(false);
  });
  it("falha de consulta não produz download parcial e libera o estado de exportação", async () => {
    state.load.mockRejectedValue(new Error("Falha ao buscar comentários"));
    const { result } = renderHook(() => useExportLeads());
    await act(async () => {
      await expect(result.current.exportLeads({ format: "xlsx", pipelineId: "pipeline-1" })).rejects.toThrow("Falha ao buscar comentários");
    });
    expect(state.from).not.toHaveBeenCalled();
    expect(result.current.isExporting).toBe(false);
  });
});
