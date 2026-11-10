import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * Avisos do "Ir para o negócio" no board: um id por PEDIDO e por papel.
 *
 * O sonner mescla toasts de mesmo id (`{...antigo, ...novo}`). Com um id só, o
 * aviso da decisão herdava o tipo `loading` do "Localizando…" — spinner que
 * nunca fecha, nem arrastando, nem por botão — e o botão "Abrir negócio" de
 * uma visita anterior.
 */
export const toastLocalizando = (nonce: number) => `foco-negocio:${nonce}:localizando`;
export const toastTodos = (nonce: number) => `foco-negocio:${nonce}:todos`;
export const toastAviso = (nonce: number) => `foco-negocio:${nonce}:aviso`;

/** Busca mais lenta que isto ganha o "Localizando o negócio…". */
export const LOCALIZANDO_APOS_MS = 400;
/** Teto do "Localizando…": passou disto sem decisão, o spinner sai (a decisão, se vier, ainda vale). */
export const LOCALIZANDO_TETO_MS = 20_000;

/**
 * "Localizando o negócio…" quando a busca do pedido passa de 400 ms. Um toast
 * `loading` nunca fecha sozinho, então ele sai em toda saída: na decisão (quem
 * decide o dispensa), ao abandonar o pedido (outro funil, saiu da página), com
 * o funil que não abre (`pausado`) e no teto.
 */
export function useAvisoLocalizando(
  nonce: number | null,
  { pausado, aindaEsperando }: { pausado: boolean; aindaEsperando: () => boolean },
): void {
  const esperando = useRef(aindaEsperando);
  esperando.current = aindaEsperando;
  useEffect(() => {
    if (nonce === null || pausado) return;
    const id = toastLocalizando(nonce);
    const aviso = setTimeout(() => {
      if (esperando.current()) toast.loading("Localizando o negócio…", { id });
    }, LOCALIZANDO_APOS_MS);
    const teto = setTimeout(() => toast.dismiss(id), LOCALIZANDO_TETO_MS);
    return () => {
      clearTimeout(aviso);
      clearTimeout(teto);
      toast.dismiss(id);
    };
  }, [nonce, pausado]);
}
