import type { NavigateFunction } from "react-router-dom";

/**
 * Clique em aviso que leva a uma conversa (hotfix Café Jurerê, flag
 * `notificacao_abre_conversa`).
 *
 * O chat lê `?instance=&phone=` UMA vez, quando monta. Com o chat já aberto,
 * `navigate(link)` só trocava a URL e a conversa do aviso não abria. O marcador
 * em `state` faz `ChatWhatsApp` remontar o shell, que então relê o link.
 */
export const CHAT_PATH = "/chat-whatsapp";

export interface EstadoAbrirConversa {
  abrirConversa: number;
}

export function ehLinkDeConversa(link: string | null | undefined): link is string {
  return !!link && (link === CHAT_PATH || link.startsWith(`${CHAT_PATH}?`));
}

export function navegarParaAviso(
  navigate: NavigateFunction,
  link: string,
  abreConversa: boolean,
): void {
  if (abreConversa && ehLinkDeConversa(link)) {
    const state: EstadoAbrirConversa = { abrirConversa: Date.now() };
    navigate(link, { state });
    return;
  }
  navigate(link);
}

export function marcadorDeAbrirConversa(state: unknown): number | undefined {
  const valor = (state as Partial<EstadoAbrirConversa> | null)?.abrirConversa;
  return typeof valor === "number" ? valor : undefined;
}
