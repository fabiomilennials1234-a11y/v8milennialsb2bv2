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
import { ETAPA_DE_PERDA_INDISPONIVEL } from "@/contracts/pipe/perda";
import { useLeadPipeHandlers } from "@/modules/leads/hooks/lead/useLeadPipeHandlers";
import {
  FakeLossReasonGateProvider,
  makeFakeLossReasonGate,
} from "@/modules/leads/loss-reason-gate/testing";

const { patchEntryMetadata } = vi.hoisted(() => ({ patchEntryMetadata: vi.fn() }));
vi.mock("@/integrations/supabase/entry-metadata", () => ({ patchEntryMetadata }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, info: vi.fn(), error: toastError } }));

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

const addToCustom = vi.fn(async () => ({ id: "entry-new" }));

let gate = makeFakeLossReasonGate();

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MockPipeOpsProvider
      port={{
        useMoveLeadInCustomPipe: (() => ({ mutateAsync: moveInCustom, isPending: false })) as never,
        useAddLeadToCustomPipe: (() => ({ mutateAsync: addToCustom, isPending: false })) as never,
      }}
    >
      <FakeLossReasonGateProvider gate={gate}>{children}</FakeLossReasonGateProvider>
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
    { id: "stage-x", name: "Perdido/Desqualificado", role: "open", isFinalNegative: true },
  ],
} as unknown as PipelineStatus;

describe("useLeadPipeHandlers.moveStage — funil personalizado", () => {
  beforeEach(() => {
    moveInCustom.mockClear();
    toastSuccess.mockClear();
    patchEntryMetadata.mockReset().mockResolvedValue(undefined);
    gate = makeFakeLossReasonGate();
  });

  it("manda a etapa nova como `stage_id`, o campo que a mutation lê", async () => {
    const { result } = renderHook(() => useLeadPipeHandlers("lead-1"), { wrapper });

    await act(() => result.current.moveStage(customPipeline, "stage-b"));

    expect(moveInCustom).toHaveBeenCalledWith({ entry_id: "entry-1", pipeline_id: "pipeline-1", stage_id: "stage-b" });
    expect(toastSuccess).toHaveBeenCalledWith('Movido para "Em conversa"');
  });

  it("etapa de perda: pede o motivo, grava no metadata e SÓ então move", async () => {
    const { result } = renderHook(() => useLeadPipeHandlers("lead-1"), { wrapper });

    await act(() => result.current.moveStage(customPipeline, "stage-x"));

    expect(gate.pedidos).toEqual([{ stageName: "Perdido/Desqualificado" }]);
    expect(patchEntryMetadata).toHaveBeenCalledWith("entry-1", { loss_reason_id: "lr-1", loss_reason: "Sem budget" });
    expect(patchEntryMetadata.mock.invocationCallOrder[0]).toBeLessThan(moveInCustom.mock.invocationCallOrder[0]);
    expect(moveInCustom).toHaveBeenCalledWith({ entry_id: "entry-1", pipeline_id: "pipeline-1", stage_id: "stage-x" });
  });

  it("cancelar o motivo não escreve nem move", async () => {
    gate.resposta = null;
    const { result } = renderHook(() => useLeadPipeHandlers("lead-1"), { wrapper });

    await act(() => result.current.moveStage(customPipeline, "stage-x"));

    expect(gate.pedidos).toHaveLength(1);
    expect(patchEntryMetadata).not.toHaveBeenCalled();
    expect(moveInCustom).not.toHaveBeenCalled();
  });

  it("falha ao gravar o motivo não move", async () => {
    patchEntryMetadata.mockRejectedValue(new Error("rede"));
    const { result } = renderHook(() => useLeadPipeHandlers("lead-1"), { wrapper });

    await act(() => result.current.moveStage(customPipeline, "stage-x"));

    expect(moveInCustom).not.toHaveBeenCalled();
  });
});

describe("useLeadPipeHandlers.addToPipeline — não nasce perdido (guarda própria)", () => {
  beforeEach(() => {
    addToCustom.mockClear();
    toastError.mockClear();
    toastSuccess.mockClear();
  });

  it("etapa de perda é recusada com aviso e nada é escrito", async () => {
    const { result } = renderHook(() => useLeadPipeHandlers("lead-1"), { wrapper });
    await act(() => result.current.addToPipeline(customPipeline, "stage-x"));
    expect(addToCustom).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(ETAPA_DE_PERDA_INDISPONIVEL);
  });

  it("etapa aberta adiciona", async () => {
    const { result } = renderHook(() => useLeadPipeHandlers("lead-1"), { wrapper });
    await act(() => result.current.addToPipeline(customPipeline, "stage-a"));
    expect(addToCustom).toHaveBeenCalledWith({ pipeline_id: "pipeline-1", lead_id: "lead-1", stage_id: "stage-a" });
    expect(toastError).not.toHaveBeenCalled();
  });
});
