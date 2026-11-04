/**
 * Rola até a bolha da mensagem original quando ela está na thread carregada.
 * Sem a bolha no DOM (fora da janela carregada ou não virtualizada) não faz
 * nada: devolve false e nada quebra.
 */
const DESTAQUE_MS = 1600;
const CLASSES_DESTAQUE = ["ring-2", "ring-primary/70", "ring-offset-2", "ring-offset-background"];

function escaparAtributo(valor: string): string {
  return valor.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function scrollToQuotedMessage(messageId: string | null | undefined, root: ParentNode = document): boolean {
  if (!messageId) return false;
  const id = escaparAtributo(messageId);
  const alvo = root.querySelector<HTMLElement>(
    `[data-wa-message-id="${id}"], [data-provider-message-id="${id}"]`,
  );
  if (!alvo) return false;

  // Quem pediu menos movimento recebe o salto direto; o destaque estático fica.
  const reduzido = typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  alvo.scrollIntoView({ block: "center", behavior: reduzido ? "auto" : "smooth" });

  alvo.classList.add(...CLASSES_DESTAQUE);
  window.setTimeout(() => alvo.classList.remove(...CLASSES_DESTAQUE), DESTAQUE_MS);
  return true;
}
