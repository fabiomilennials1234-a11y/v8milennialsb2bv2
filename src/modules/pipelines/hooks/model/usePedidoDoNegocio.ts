import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { IR_PARA_NEGOCIO_FLAG, negocioDaUrl, semNegocio } from "@/contracts/pipe/negocio-no-funil";
import { useFeatureFlag } from "@/modules/platform/hooks/useFeatureFlag";
import type { PedidoDeFoco } from "./useFocoNoNegocio";

export type PedidoDoNegocio = PedidoDeFoco & {
  /** O `:slug` da rota quando o pedido chegou — o pedido é deste funil. */
  funil: string | undefined;
  /** O botão do chat foi ativado pelo teclado: o board leva o foco até o card. */
  viaTeclado: boolean;
};

/**
 * O pedido "Ir para o negócio" que chega pela URL (`?negocio=<entryId>`). É
 * consumido UMA vez e sai da URL (a troca de visão salva reescreveria a query
 * inteira; F5 não repete a chegada).
 *
 * Piloto por org, e o board é o kill switch: sem a flag ele não reage ao
 * endereço — nem a links já enviados — e só limpa a URL. Desligar a flag
 * desliga o chat e o board juntos.
 *
 * Devolve só o pedido DESTE funil: no redirect "outro-funil", o pedido velho
 * ainda existe por um render com o funil novo — e buscaria o foco à toa.
 */
export function usePedidoDoNegocio(param: string | undefined): {
  pedido: PedidoDoNegocio | null;
  /** O piloto está ligado para a org. */
  ligado: boolean;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const flag = useFeatureFlag(IR_PARA_NEGOCIO_FLAG);
  const [pedido, setPedido] = useState<PedidoDoNegocio | null>(null);

  // A página não desmonta ao trocar de funil: outro funil sem pedido encerra o
  // pedido. (ANTES do effect da URL: no redirect para o funil certo, o pedido
  // velho sai e o novo, que a URL traz, entra no mesmo commit.)
  useEffect(() => {
    setPedido((atual) => (atual && atual.funil !== param ? null : atual));
  }, [param]);

  useEffect(() => {
    const entryId = negocioDaUrl(searchParams);
    if (!entryId || flag.isLoading) return;
    if (flag.enabled) {
      const viaTeclado = (location.state as { viaTeclado?: boolean } | null)?.viaTeclado === true;
      setPedido({ entryId, nonce: Date.now(), funil: param, viaTeclado });
    }
    setSearchParams((atual) => semNegocio(atual), { replace: true });
  }, [searchParams, setSearchParams, param, location.state, flag.isLoading, flag.enabled]);

  return { pedido: pedido && pedido.funil === param ? pedido : null, ligado: flag.enabled };
}
