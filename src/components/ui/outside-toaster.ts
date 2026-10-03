/**
 * Clique num toast não é "clique fora" de um modal.
 *
 * Com um Dialog/Sheet do Radix aberto, tudo fora do conteúdo conta como
 * interação externa e fecha o modal. O toast de erro (ADR-0038) mora fora dele
 * e tem botões — "copiar código", "Falar com suporte". Sem esta exceção, copiar
 * o código de um erro fechava o formulário e o cliente perdia o que digitou.
 * Medido na validação ponta a ponta do ADR-0038.
 */
export function ignoreToasterInteraction<E extends { target: EventTarget | null; preventDefault(): void }>(
  handler?: (event: E) => void,
): (event: E) => void {
  return (event) => {
    const target = event.target as Element | null;
    if (target?.closest?.("[data-sonner-toaster]")) {
      event.preventDefault();
      return;
    }
    handler?.(event);
  };
}
