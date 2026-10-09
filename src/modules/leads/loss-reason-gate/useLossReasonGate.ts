/**
 * Contrato da porta do motivo da perda — contexto + hook. O provider e o
 * diálogo moram em `LossReasonGate.tsx` (ver o cabeçalho de lá).
 */
import { createContext, useCallback, useContext, useMemo } from "react";
import { toast } from "sonner";
import { notifyError } from "@/shared/errors";
import type { PerdaResolvida } from "@/contracts/pipe/perda";
import { persistirMotivoDaPerda } from "./persistirMotivoDaPerda";

export interface PedidoDeMotivoDaPerda {
  /** Nome da etapa de destino — entra na frase do diálogo. */
  stageName?: string | null;
  /** Lote: quantos negócios o motivo vai cobrir (ação em massa). */
  quantidade?: number;
}

export type RequestLossReason = (pedido?: PedidoDeMotivoDaPerda) => Promise<PerdaResolvida | null>;

export const LossReasonGateContext = createContext<RequestLossReason | null>(null);

/** Porta fechada: sem provider, nada se move sem motivo. */
const portaFechada: RequestLossReason = async () => {
  toast.error("Não foi possível pedir o motivo da perda. Nada foi alterado.");
  return null;
};

export interface CapturaDoMotivo extends PedidoDeMotivoDaPerda {
  /** `pipeline_entries.id` que recebem o motivo no metadata. */
  entryIds: string[];
}

export interface UseLossReasonGateResult {
  /**
   * Há provider montado? Com a porta FECHADA, `requestLossReason` já avisa por
   * conta própria — quem chama não deve somar um segundo toast ("cancelada").
   */
  portaAberta: boolean;
  /** Só pergunta. `null` = cancelou (ou porta fechada, que já avisou). */
  requestLossReason: RequestLossReason;
  /**
   * Pergunta E grava o motivo no metadata de cada entrada — o passo 1 de todo
   * movimento para perda, ANTES do move (o desfecho viaja com a transição,
   * mesma ordem do `/funil`). `null` = cancelou OU a gravação falhou (o toast
   * já saiu): em ambos, quem chama NÃO move.
   */
  capturarMotivoDaPerda: (captura: CapturaDoMotivo) => Promise<PerdaResolvida | null>;
}

export function useLossReasonGate(): UseLossReasonGateResult {
  const doProvider = useContext(LossReasonGateContext);
  const portaAberta = doProvider !== null;
  const requestLossReason = doProvider ?? portaFechada;

  const capturarMotivoDaPerda = useCallback(
    async ({ entryIds, ...pedido }: CapturaDoMotivo) => {
      const perda = await requestLossReason(pedido);
      if (!perda) return null;
      try {
        await persistirMotivoDaPerda(entryIds, perda);
      } catch (error) {
        notifyError(error, {
          fallback: "Não foi possível registrar o motivo da perda. Nada foi movido.",
        });
        return null;
      }
      return perda;
    },
    [requestLossReason],
  );

  return useMemo(
    () => ({ portaAberta, requestLossReason, capturarMotivoDaPerda }),
    [portaAberta, requestLossReason, capturarMotivoDaPerda],
  );
}

