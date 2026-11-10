import type { MutableRefObject } from "react";
import { useLevarAoNegocio, type AlvoDaCamera } from "./useLevarAoNegocio";

/**
 * A chegada do "Ir para o negócio" no board, num componente próprio: as
 * assinaturas de "o board está buscando?" (`useIsFetching`) re-renderizam SÓ
 * este nó, nunca o board — que re-renderiza todos os cards a cada render.
 * Montado pelo `FunilKanban` apenas quando há uma chegada.
 *
 * Também é a região que diz a chegada ao leitor de tela.
 */
export function ChegadaAoNegocio({
  alvo,
  etapa,
  pipelineId,
  registro,
  onNaoDeu,
}: {
  alvo: AlvoDaCamera;
  /** A coluna em que o card do alvo está agora (`null` = ainda não está no board). */
  etapa: string | null;
  pipelineId: string;
  /** O nonce que já viajou (da página: remontar não repete a chegada). */
  registro: MutableRefObject<number | null>;
  onNaoDeu: (alvo: AlvoDaCamera) => void;
}) {
  const { anuncio } = useLevarAoNegocio({ alvo, etapa, pipelineId, registro, onNaoDeu });
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {anuncio}
    </div>
  );
}
