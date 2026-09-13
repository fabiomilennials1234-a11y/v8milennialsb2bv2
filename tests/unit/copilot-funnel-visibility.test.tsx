import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/modules/pipelines", async () => ({
  ...await import("@/modules/pipelines/lib/pipeline-navigation"),
  useFunisAtivosDaOrg: () => ({ data: [
    { id: "hidden-id", slug: "hidden", type: "custom", label: "Funil oculto", config: { navigation: { is_visible: false } } },
    { id: "visible-id", slug: "visible", type: "custom", label: "Funil visível", config: {} },
  ], isLoading: false }),
}));
vi.mock("@/modules/copilot/hooks/useOrgFunnelStages", () => ({
  useOrgFunnelStages: () => ({ byPipelineId: new Map([
    ["hidden-id", [{ stage_key: "stage", name: "Etapa preservada" }]],
  ]), isLoading: false }),
}));
import { useCopilotFunnelOptions } from "@/modules/copilot/hooks/usePipeTypeOptions";

it("marks hidden choices while preserving saved labels and stage resolution", () => {
  const { result } = renderHook(() => useCopilotFunnelOptions({ incluirCampanha: false }));
  expect(result.current.options.filter((option) => option.isVisible !== false).map((option) => option.value)).toEqual(["visible-id"]);
  expect(result.current.labelForRef("hidden-id")).toBe("Funil oculto");
  expect(result.current.stagesByPipe["hidden-id"]).toEqual([{ value: "stage", label: "Etapa preservada" }]);
});
