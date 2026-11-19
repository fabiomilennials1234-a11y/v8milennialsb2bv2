import { useEffect, useRef } from "react";
import { calcularUtil, instanteDaMedicao, registrarUtil, type Tela } from "./medicao";

/**
 * Marca o instante em que a tela ficou ÚTIL (dado real na tela, não skeleton).
 *
 * Uma vez por montagem, na primeira vez que `pronto` é verdadeiro — um `pronto`
 * que volta a falso (refetch) e sobe de novo não conta outra vez. Pronto já na
 * montagem (cache quente, prefetch) também conta: é exatamente o ganho que o
 * prefetch existe para dar.
 *
 * `pronto` é "o dado que o usuário veio buscar está na tela", nunca
 * `!isFetching`: refetch em segundo plano não é espera.
 */
export function useMarcarUtil(tela: Tela, pronto: boolean): void {
  const montadoEm = useRef<number | null>(null);
  if (montadoEm.current === null) montadoEm.current = instanteDaMedicao();
  const marcado = useRef(false);

  useEffect(() => {
    if (!pronto || marcado.current) return;
    marcado.current = true;
    const util = calcularUtil(montadoEm.current ?? 0, instanteDaMedicao());
    if (util) registrarUtil(tela, util.ms, util.origem);
  }, [pronto, tela]);
}
