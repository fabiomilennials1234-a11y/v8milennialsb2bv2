/**
 * Fecha um negócio (ganho/perda) direto do painel do chat.
 *
 * Ordem, e por quê:
 *  1. Gate de tarefas pendentes do negócio (o mesmo do Card do Negócio).
 *  2. Perda: motivo OBRIGATÓRIO, pela porta única, ANTES de qualquer escrita
 *     (cancelou = nada escrito). Fica no metadata e vai à RPC.
 *  3. Mover o card, se o usuário escolheu outra etapa.
 *  4. Desfecho pela RPC `definir_desfecho_da_entrada` (idempotente, valida org).
 *
 * Mover vem ANTES do desfecho de propósito: é o pedido, e o desfecho é o que
 * grava a venda em `sale_events`. Se o desfecho falha depois do move, o retorno
 * diz isso (`moveu: true`) e a tela avisa, em vez de fingir que nada aconteceu.
 *
 * Valor da venda: quem exige é o BANCO (`fn_exige_valor_no_negocio`), e a tela
 * não adivinha. Recusa por falta de valor vira `pede-valor`, com o motivo da
 * perda e o "já movi" preservados para a segunda tentativa só do desfecho.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isSaleValueRequiredError } from "@/lib/rpc-errors";
import { useTaskMoveGate } from "@/modules/engagement/tasks";
import type { PerdaResolvida } from "@/contracts/pipe/perda";
import { planoDeFechamento, type DesfechoDoChat } from "@/modules/communication/lib/fechar-negocio-chat";

/**
 * Quem move o card e quem pede o motivo da perda são INJETADOS (o painel já usa
 * `useMovePipelineEntry` e `useLossReasonGate`): importar `@/modules/pipelines`
 * ou `@/modules/leads` daqui fecha ciclos com `communication`.
 */
export type MoverEtapa = (args: { id: string } & ({ stageId: string } | { stageKey: string })) => Promise<unknown>;
export type CapturarMotivoDaPerda = (args: { entryIds: string[]; stageName?: string }) => Promise<PerdaResolvida | null>;

export interface DependenciasDoFechamento {
  moverEtapa: MoverEtapa;
  capturarMotivoDaPerda: CapturarMotivoDaPerda;
}

export interface DestinoDeEtapa {
  key: string;
  stageId?: string;
  label: string;
}

export interface PedidoDeFechamento {
  entryId: string;
  desfecho: DesfechoDoChat;
  etapaAtualKey: string | null;
  /** `null` = manter na etapa atual. */
  destino: DestinoDeEtapa | null;
}

export type ResultadoDeFechamento =
  | { status: "ok" }
  /** Gate de tarefa ou motivo da perda cancelados: nada foi escrito. */
  | { status: "cancelado" }
  | { status: "pede-valor"; perda: PerdaResolvida | null; moveu: boolean }
  /** A etapa mudou, o desfecho não foi registrado. */
  | { status: "falhou-depois-de-mover"; destino: string; erro: unknown };

const QUERIES_DO_DESFECHO = [
  "deal-menu-outcome",
  "deal-card-extras",
  "funil-desfecho-counts",
  "pipeline-desfecho-por-mes",
  "pipeline-page",
  "pipeline-stage-counts",
  "pipeline_entries",
  "custom_pipe_entries",
  "custom_pipe_stage_counts",
  "leads-sales-metrics",
  "leads-deals",
  "lead_all_pipelines",
];

export function useFecharNegocioNoChat({ moverEtapa, capturarMotivoDaPerda }: DependenciasDoFechamento) {
  const queryClient = useQueryClient();
  const requestTaskMove = useTaskMoveGate();

  const invalidar = useCallback(
    () => Promise.all(QUERIES_DO_DESFECHO.map((key) => queryClient.invalidateQueries({ queryKey: [key] }))),
    [queryClient],
  );

  /** Só a escrita do desfecho. Usada direto na segunda tentativa, depois do valor. */
  const registrarDesfecho = useCallback(
    async (args: { entryId: string; desfecho: DesfechoDoChat; perda: PerdaResolvida | null; valor?: number }) => {
      const { error } = await supabase.rpc("definir_desfecho_da_entrada", {
        p_entry_id: args.entryId,
        p_outcome: args.desfecho,
        p_loss_reason: args.perda?.texto ?? undefined,
        // Mesma chamada do desfecho, nunca antes: a trava de valor é BEFORE UPDATE OF outcome.
        ...(args.valor !== undefined ? { p_valor: args.valor } : {}),
      } as never);
      if (error) throw error;
      toast.success(args.desfecho === "won" ? "Negócio ganho" : "Negócio perdido");
      await invalidar();
    },
    [invalidar],
  );

  const fechar = useCallback(
    async (pedido: PedidoDeFechamento): Promise<ResultadoDeFechamento> => {
      const { entryId, desfecho, etapaAtualKey, destino } = pedido;

      if (!(await requestTaskMove(entryId))) return { status: "cancelado" };

      let perda: PerdaResolvida | null = null;
      if (desfecho === "lost") {
        perda = await capturarMotivoDaPerda({ entryIds: [entryId], stageName: destino?.label });
        if (!perda) return { status: "cancelado" };
      }

      const plano = planoDeFechamento({ etapaAtualKey, destinoKey: destino?.key ?? null });
      if (plano.mover && destino) {
        await moverEtapa({
          id: entryId,
          ...(destino.stageId ? { stageId: destino.stageId } : { stageKey: destino.key }),
        });
      }

      try {
        await registrarDesfecho({ entryId, desfecho, perda });
        return { status: "ok" };
      } catch (erro) {
        if (isSaleValueRequiredError(erro as never)) {
          if (plano.mover) await invalidar();
          return { status: "pede-valor", perda, moveu: plano.mover };
        }
        if (plano.mover && destino) {
          await invalidar();
          return { status: "falhou-depois-de-mover", destino: destino.label, erro };
        }
        throw erro;
      }
    },
    [requestTaskMove, capturarMotivoDaPerda, moverEtapa, registrarDesfecho, invalidar],
  );

  return { fechar, registrarDesfecho };
}
