import { useCallback, useMemo } from "react";
import { toast } from "sonner";

import {
  assertMemberInOrg,
  useAddLeadToStandardPipe,
  type CustomPipelineStatus,
  type PipelineStatus,
  type StandardPipelineStatus,
} from "../../../../hooks/useLeadAllPipelines";
import { usePipeOps } from "../../../../pipe-ops";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import type { NewDealOption, NewDealValues } from "./NewDealDialog";
import {
  buildNewDealOptions,
  resolveNewDealTarget,
  type NewDealGate,
} from "./newDealOptions";

/**
 * A porta única de abertura de negócio, do lado do cliente.
 *
 * ADR-0023 decisão 3 diz que negócio nasce por clique humano; o que faltava era
 * o clique poder vir de mais de um lugar sem duplicar a regra. Antes deste hook
 * o roteamento (`sys:` → `abrir_negocio`, `custom:` → `custom_pipe_entries`), a
 * guarda de dono cross-org, o log e os toasts viviam dentro do `CrossPipePanel`
 * — e o botão "Criar negócio" do Card do Lead não tinha como alcançá-los.
 *
 * Quem chama entrega os dados que **já** buscou (`pipelines`, permissão, se há
 * venda fechada). O hook não busca nada: assim o painel não paga uma segunda
 * query e o card monta o mesmo comportamento com as suas.
 */

export interface UseAbrirNegocioInput {
  leadId: string | null;
  organizationId: string | null;
  pipelines: PipelineStatus[];
  canAdd: NewDealGate;
  /** `pipe_propostas.status === "vendido"` — é o que destrava a Carteira. */
  vendaFechada: boolean;
  /** Chamado só depois que a escrita deu certo. */
  onCreated?: (option: NewDealOption) => void;
}

export interface AbrirNegocioApi {
  options: NewDealOption[];
  isCreating: boolean;
  criar: (option: NewDealOption, values: NewDealValues) => Promise<void>;
}

export function useAbrirNegocio({
  leadId,
  organizationId,
  pipelines,
  canAdd,
  vendaFechada,
  onCreated,
}: UseAbrirNegocioInput): AbrirNegocioApi {
  const { useAddLeadToCustomPipe } = usePipeOps();
  const addStandard = useAddLeadToStandardPipe();
  const addCustom = useAddLeadToCustomPipe();
  const logAction = useLogLeadAction();

  const options = useMemo(
    () => buildNewDealOptions(pipelines, { canAdd, vendaFechada }),
    [pipelines, canAdd, vendaFechada],
  );

  const criarSystem = useCallback(
    async (pipe: StandardPipelineStatus, values: NewDealValues) => {
      if (!leadId) throw new Error("Lead não encontrado");
      if (!pipe.stages.length) {
        toast.error("Funil sem etapas configuradas");
        throw new Error("Funil sem etapas configuradas");
      }
      const stageId = values.stageId || pipe.stages[0].id;
      try {
        await addStandard.mutateAsync({
          leadId,
          pipeType: pipe.pipeType,
          stageId,
          ownerId: values.ownerId ?? null,
          saleValue: values.saleValue ?? null,
          meetingDate: values.meetingDate ?? null,
          notes: values.notes ?? null,
        });
        void logAction({
          leadId,
          action: "pipe_added",
          description: `Negócio aberto em ${pipe.label}`,
          metadata: {
            pipe_type: pipe.pipeType,
            stage_key: stageId,
            owner_id: values.ownerId ?? null,
            sale_value: values.saleValue ?? null,
          },
        });
        toast.success(`Negócio aberto em ${pipe.label}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao criar negócio";
        toast.error(msg);
        // Repropaga: o modal segura o rascunho digitado em vez de fechar como
        // se tivesse dado certo.
        throw err;
      }
    },
    [addStandard, leadId, logAction],
  );

  const criarCustom = useCallback(
    async (pipe: CustomPipelineStatus, values: NewDealValues) => {
      if (!leadId) throw new Error("Lead não encontrado");
      if (!pipe.stages.length) {
        toast.error("Funil sem etapas configuradas");
        throw new Error("Funil sem etapas configuradas");
      }
      const stageId = values.stageId || pipe.stages[0].id;
      try {
        // Mesma guarda do caminho system: `custom_pipe_entries` valida o
        // `organization_id` da LINHA, nunca o org de `assigned_to`.
        const ownerInOrg = values.ownerId ?? null;
        if (ownerInOrg) {
          if (!organizationId) throw new Error("Organização não encontrada");
          await assertMemberInOrg(ownerInOrg, organizationId);
        }
        await addCustom.mutateAsync({
          lead_id: leadId,
          pipeline_id: pipe.pipelineId,
          stage_id: stageId,
          ...(ownerInOrg ? { assigned_to: ownerInOrg } : {}),
          ...(values.notes ? { notes: values.notes } : {}),
        });
        void logAction({
          leadId,
          action: "pipe_added",
          description: `Negócio aberto em ${pipe.pipelineName}`,
          metadata: {
            pipe_type: "custom",
            pipeline_id: pipe.pipelineId,
            stage_id: stageId,
            owner_id: values.ownerId ?? null,
          },
        });
        toast.success(`Negócio aberto em ${pipe.pipelineName}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao criar negócio";
        toast.error(msg);
        throw err;
      }
    },
    [addCustom, leadId, organizationId, logAction],
  );

  const criar = useCallback(
    async (option: NewDealOption, values: NewDealValues) => {
      const target = resolveNewDealTarget(option.key, pipelines);
      if (!target) throw new Error("Funil não encontrado");
      if (target.kind === "custom") await criarCustom(target.pipe, values);
      else await criarSystem(target.pipe, values);
      onCreated?.(option);
    },
    [pipelines, criarCustom, criarSystem, onCreated],
  );

  return {
    options,
    isCreating: addStandard.isPending || addCustom.isPending,
    criar,
  };
}
