import { useEffect, useRef, useState } from "react";
import { REGUA } from "./regua";

/**
 * Esqueleto que JÁ nasce visível (ex.: o fallback do Suspense que a tela
 * continua mostrando enquanto busca dados) cumpre o mínimo da régua: ao
 * terminar a espera, ele fica até completar `REGUA.skeletonMinMs` desde o
 * primeiro quadro em que esta tela o mostrou — sem piscar dado por 40 ms.
 *
 * Diferente da `Espera`, aqui não há fase invisível (< 100 ms): o esqueleto
 * já está na tela quando a tela monta, e escondê-lo piscaria. Vale só para a
 * PRIMEIRA espera da montagem; depois de liberado, nunca segura de novo.
 *
 * Devolve `true` enquanto o esqueleto deve continuar na tela além da espera.
 */
export function useSegurarEsqueleto(esperando: boolean): boolean {
  // Date.now (não performance.now): é o relógio que os fake timers controlam.
  const desde = useRef<number | null>(null);
  const [liberado, setLiberado] = useState(false);
  if (esperando && desde.current === null) desde.current = Date.now();
  const restante = desde.current === null ? 0 : REGUA.skeletonMinMs - (Date.now() - desde.current);
  const segurar = !esperando && !liberado && restante > 0;

  useEffect(() => {
    if (!segurar) return;
    const t = setTimeout(() => setLiberado(true), restante);
    return () => clearTimeout(t);
    // `restante` lido só na virada para "segurar", de propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segurar]);

  return segurar;
}
