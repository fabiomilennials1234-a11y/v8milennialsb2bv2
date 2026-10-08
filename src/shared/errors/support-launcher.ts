/**
 * Ponte entre um erro e o Chamado.
 *
 * `notifyError` é função, não hook, e roda fora da árvore do React; o painel de
 * suporte vive no módulo `platform`, que `shared` não pode importar. Então o
 * painel se registra aqui ao montar, e o toast chama `openSupport`. Sem painel
 * montado (login, tela pública, tela quebrada pelo boundary), `canOpenSupport`
 * é falso e o toast oferece copiar o código em vez disso.
 */

export interface SupportPrefill {
  title: string;
  description: string;
}

type SupportLauncher = (prefill: SupportPrefill) => void;

let launcher: SupportLauncher | null = null;

/** Registra o painel. Devolve a função que desfaz o registro (para o unmount). */
export function registerSupportLauncher(next: SupportLauncher): () => void {
  launcher = next;
  return () => {
    if (launcher === next) launcher = null;
  };
}

export function canOpenSupport(): boolean {
  return launcher !== null;
}

export function openSupport(prefill: SupportPrefill): boolean {
  if (!launcher) return false;
  launcher(prefill);
  return true;
}

/** O rascunho de Chamado que um erro gera. */
export function supportPrefillFor(userMessage: string, reference: string): SupportPrefill {
  const title = `Erro: ${userMessage}`;
  return {
    title: title.length > 120 ? `${title.slice(0, 119)}…` : title,
    description: `Código do erro: ${reference}\n\nO que eu estava fazendo quando aconteceu:\n`,
  };
}
