import { useMarcarUtil } from "./useMarcarUtil";
import type { Tela } from "./medicao";

/**
 * `useMarcarUtil` em forma de componente, para telas que vivem montadas e só
 * ABREM (gaveta, painel): renderizado só enquanto a tela está aberta, cada
 * abertura é uma montagem nova — e uma medida nova.
 */
export function MarcarUtil({ tela, pronto }: { tela: Tela; pronto: boolean }) {
  useMarcarUtil(tela, pronto);
  return null;
}
