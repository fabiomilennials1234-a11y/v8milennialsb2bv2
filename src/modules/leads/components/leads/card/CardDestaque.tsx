import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { encerrarDestaque, useDestaqueDoCard, type DestaqueAtivo } from "../../../lib/card-effects";

/**
 * O brilho de 5 s do card que o "Ir para o negócio" veio buscar: a borda do
 * cartão acende em ouro, pousa, respira e apaga. Fica DENTRO do card (o CSS
 * `.card-destaque` em index.css), por cima do conteúdo, sem capturar clique.
 *
 * Como o `CardOutcomeBurst`, é o único assinante do store no card — só ele
 * re-renderiza quando o destaque chega. A linha do tempo é do CSS; aqui só o
 * atraso dela (`--destaque-atraso`), medido do relógio do destaque UMA vez:
 * o card que remonta no meio continua de onde estava, e um re-render não a
 * reinicia.
 *
 * Tocar no card é o "achei": o brilho sai rápido (`encerrarDestaque`). O
 * `pointerdown` chega antes dos 8 px que iniciam o arrasto, então o clone do
 * arrasto não carrega o brilho junto.
 */
export const CardDestaque = memo(function CardDestaque({ entryId }: { entryId: string }) {
  const destaque = useDestaqueDoCard(entryId);
  if (!destaque) return null;
  return <Camadas key={destaque.id} entryId={entryId} destaque={destaque} />;
});

function Camadas({ entryId, destaque }: { entryId: string; destaque: DestaqueAtivo }) {
  const camada = useRef<HTMLDivElement>(null);
  const [atraso] = useState(() => Math.round(destaque.inicio - performance.now()));

  useEffect(() => {
    const card = camada.current?.parentElement;
    if (!card) return;
    const achei = () => encerrarDestaque(entryId);
    card.addEventListener("pointerdown", achei);
    return () => card.removeEventListener("pointerdown", achei);
  }, [entryId]);

  return (
    <div
      ref={camada}
      aria-hidden
      data-testid="card-destaque"
      className="card-destaque"
      data-saindo={destaque.saindo ? "" : undefined}
      style={{ "--destaque-atraso": `${atraso}ms` } as CSSProperties}
    >
      <span className="card-destaque__clarao" />
      <span className="card-destaque__brilho" />
      <span className="card-destaque__aro" />
    </div>
  );
}
