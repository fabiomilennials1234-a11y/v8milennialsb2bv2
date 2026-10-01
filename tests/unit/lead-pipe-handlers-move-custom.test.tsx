/**
 * Mover o negócio de etapa num funil personalizado (TORQUE-WEB-9).
 *
 * `moveStage` mandava `new_stage_id`, mas `useMoveLeadInCustomPipe` lê
 * `stage_id`: a consulta saía como `pipeline_stages?id=eq.undefined` e o
 * PostgREST respondia 400 (`22P02`). O TS2561 que acusava isso estava
 * congelado no `.tsc-baseline.json` desde abril.
 *
 * O dublê recusa a chamada sem `stage_id`, como a consulta real recusa — um
 * dublê que aceita qualquer forma deixaria o defeito passar de novo.
 */
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockPipeOpsProvider } from "@/modules/leads/pipe-ops/testing";
import type { PipelineStatus } from "@/modules/leads/hooks/useLeadAllPipelines";
import { useLeadPipeHandlers } from "@/modules/leads/hooks/lead/useLeadPipeHandlers";

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, info: vi.fn() } }));

vi.mock("@/modules/leads/hooks/useLeadAllPipelines", () => {
  const inertMutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useAddLeadToStandardPipe: inertMutation,
    useMoveLeadInStandardPipe: inertMutation,
    useRemoveLeadFromStandardPipe: inertMutation,
  };
});

const moveInCustom = vi.fn(async (vars: { entry_id: string; pipeline_id: string; stage_id: string }) => {
  if (!vars.stage_id) throw { code: "22P02", message: 'invalid input syntax for type uuid: "undefined"', details: null, hint: null };
  return {};
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MockPipeOpsProvider
      port={{ useMoveLeadInCustomPipe: (() => ({ mutateAsync: moveInCustom, isPending: false })) as never }}
    >
      {children}
    </MockPipeOpsProvider>
  );
}

const customPipeline = {
  type: "custom",
  entryId: "entry-1",
  pipelineId: "pipeline-1",
  pipelineName: "Funil de Vendas",
  stages: [
    { id: "stage-a", name: "Novo" },
    { id: "stage-b", name: "Em conversa" },
  ],
} as unknown as PipelineStatus;

describe("useLeadPipeHandlers.moveStage — funil personalizado", () => {
  beforeEach(() => {
    moveInCustom.mockClear();
    toastSuccess.mockClear();
  });

  it("manda a etapa nova como `stage_id`, o campo que a mutation lê", async () => {
    const { result } = renderHook(() => useLeadPipeHandlers("lead-1"), { wrapper });

    await act(() => result.current.moveStage(customPipeline, "stage-b"));

    expect(moveInCustom).toHaveBeenCalledWith({ entry_id: "entry-1", pipeline_id: "pipeline-1", stage_id: "stage-b" });
    expect(toastSuccess).toHaveBeenCalledWith('Movido para "Em conversa"');
  });
});
