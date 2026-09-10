import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const { exportLeads } = vi.hoisted(() => ({ exportLeads: vi.fn().mockResolvedValue({ count: 1, unit: "negócios" }) }));
vi.mock("@/modules/leads/hooks/useExportLeads", () => ({ useExportLeads: () => ({ exportLeads, isExporting: false }) }));
vi.mock("@/modules/identity", () => ({ useTeamMembers: () => ({ data: [] }), useOrganizationSettings: () => ({ settings: {} }) }));
vi.mock("@/modules/leads/hooks/useTags", () => ({ useTags: () => ({ data: [] }) }));
vi.mock("@/modules/leads/pipe-ops", () => ({ usePipeOps: () => ({ useFunnels: () => ({ data: [] }), useFunnelStages: () => ({ data: [] }) }) }));
vi.mock("@/modules/leads/hooks/useBulkActions", () => {
  const hook = () => ({ mutateAsync: vi.fn(), isPending: false });
  return { useBulkMoveToPipeline: hook, useBulkAssign: hook, useBulkTag: hook, useBulkDelete: hook, useBulkRemoverNegocios: hook };
});
vi.mock("@/modules/leads/components/bulk-actions/QuickBlastDialog", () => ({ QuickBlastDialog: () => null }));
vi.mock("@/components/ui/select", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;
  return {
    Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: ReactNode }) => <select aria-label="Formato" value={value} onChange={e => onValueChange(e.target.value)}>{children}</select>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
    SelectContent: Wrapper, SelectGroup: Wrapper, SelectLabel: () => null, SelectSeparator: () => null, SelectTrigger: () => null, SelectValue: () => null,
  };
});
import { BulkActionBar } from "@/modules/leads/components/bulk-actions/BulkActionBar";

describe("Excel da seleção em lote preserva contexto", () => {
  it.each(["pipeline-1", undefined])("encaminha seleção e kanban %s ao exportador", async pipelineId => {
    exportLeads.mockClear();
    render(<BulkActionBar selectedIds={new Set(["lead-1"])} leadIds={["lead-1", "lead-2"]} onClear={() => {}} escopoFunil={pipelineId ? { pipelineId } : undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Exportar" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByRole("combobox", { name: "Formato" }), { target: { value: "xlsx" } });
    fireEvent.click(dialog.getByRole("button", { name: "Exportar" }));
    await waitFor(() => expect(exportLeads).toHaveBeenCalledWith({ format: "xlsx", leadIds: ["lead-1"], ...(pipelineId ? { pipelineId } : {}) }));
  });
});
