import { useCallback, useMemo } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useLeadPhones } from "../../../../hooks/useLeadPhones";
import { mensagemDoErroDeTelefone, rotuloDoTelefone } from "../../../../lib/lead-phones";

import {
  assertMemberInOrg,
  useAddLeadToStandardPipe,
  type CustomPipelineStatus,
  type PipelineStatus,
  type StandardPipelineStatus,
} from "../../../../hooks/useLeadAllPipelines";
import { usePipeOps } from "../../../../pipe-ops";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { notifyError } from "@/shared/errors";
import { ETAPA_DE_PERDA_INDISPONIVEL } from "@/contracts/pipe/perda";
import { etapaDoLeadEhDePerda } from "../../../../lib/etapa-de-perda";
import type { NewDealOption, NewDealPhoneOption, NewDealValues } from "./NewDealDialog";
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
  /** Telefones do lead para "Com quem é este negócio" (Chamado 82c50502). */
  phones: NewDealPhoneOption[];
  isCreating: boolean;
  criar: (option: NewDealOption, values: NewDealValues) => Promise<void>;
}

/**
 * Etapa em que o negócio nasce: a escolhida, ou a primeira não-perda. Etapa de
 * perda é recusada — nascer perdido gravaria a perda sem motivo (o diálogo já a
 * desabilita; isto é a guarda do caminho programático).
 */
export function etapaDeAbertura(
  stages: { id: string; role?: string | null; isFinalNegative?: boolean }[],
  escolhida: string | null | undefined,
): string {
  if (escolhida) {
    const etapa = stages.find((s) => s.id === escolhida);
    if (etapaDoLeadEhDePerda(etapa)) {
      toast.error(ETAPA_DE_PERDA_INDISPONIVEL);
      throw new Error("etapa_de_perda_na_abertura");
    }
    return escolhida;
  }
  const primeira = stages.find((s) => !etapaDoLeadEhDePerda(s));
  if (!primeira) {
    toast.error("Funil sem etapa de entrada (todas são de perda)");
    throw new Error("funil_sem_etapa_de_entrada");
  }
  return primeira.id;
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
  const { data: telefones } = useLeadPhones(leadId);
  const phones = useMemo<NewDealPhoneOption[]>(
    () => (telefones ?? []).map((t) => ({ id: t.id, label: rotuloDoTelefone(t) })),
    [telefones],
  );

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
      const stageId = etapaDeAbertura(pipe.stages, values.stageId);
      try {
        await addStandard.mutateAsync({
          leadId,
          pipeType: pipe.pipeType,
          stageId,
          ownerId: values.ownerId ?? null,
          saleValue: values.saleValue ?? null,
          meetingDate: values.meetingDate ?? null,
          notes: values.notes ?? null,
          leadPhoneId: values.leadPhoneId ?? null,
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
        const msg = (err as { message?: string } | null)?.message;
        if (msg === "lead_phone_required" || msg === "lead_phone_invalid") {
          toast.error(mensagemDoErroDeTelefone({ message: msg }));
        } else {
          notifyError(err, { fallback: "Não foi possível criar o negócio." });
        }
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
      const stageId = etapaDeAbertura(pipe.stages, values.stageId);
      try {
        // Mesma guarda do caminho system: `custom_pipe_entries` valida o
        // `organization_id` da LINHA, nunca o org de `assigned_to`.
        const ownerInOrg = values.ownerId ?? null;
        if (ownerInOrg) {
          if (!organizationId) throw new Error("Organização não encontrada");
          await assertMemberInOrg(ownerInOrg, organizationId);
        }
        const entry = await addCustom.mutateAsync({
          lead_id: leadId,
          pipeline_id: pipe.pipelineId,
          stage_id: stageId,
          ...(ownerInOrg ? { assigned_to: ownerInOrg } : {}),
          ...(values.notes ? { notes: values.notes } : {}),
        });
        // Funil custom não passa por `abrir_negocio`: a posição nasce primeiro
        // e o negócio é materializado aqui, já com o telefone escolhido
        // (Chamado 82c50502). `garantir_negocio_da_entrada` é idempotente.
        const entryId = (entry as { id?: string } | null | undefined)?.id;
        if (values.leadPhoneId && entryId) {
          const { data: dealId, error: dealErr } = await supabase.rpc("garantir_negocio_da_entrada", {
            p_entry_id: entryId,
          });
          if (dealErr) throw dealErr;
          if (dealId) {
            const { error: phoneErr } = await supabase.rpc("definir_telefone_do_negocio", {
              p_deal_id: dealId as string,
              p_lead_phone_id: values.leadPhoneId,
            });
            if (phoneErr) throw phoneErr;
          }
        }
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
        notifyError(err, { fallback: "Não foi possível criar o negócio." });
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
    phones,
    isCreating: addStandard.isPending || addCustom.isPending,
    criar,
  };
}
