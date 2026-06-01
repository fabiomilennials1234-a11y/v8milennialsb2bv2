/**
 * `computeNeedsDeepLinkResolve` — decide se a página de chat precisa disparar
 * `useResolveChatDeepLink` no servidor para descobrir qual instância abrir.
 *
 * Curto-circuita quando o link de entrada já trouxe uma instância válida
 * (`/chat-whatsapp?phone=X&instance=Y`). Match exato contra a lista de
 * instâncias permitidas garante defesa multi-tenant — instância fora da
 * lista cai pro resolver normal (que filtra por org_id + allowedIds).
 *
 * Extraído de `ChatShellWithContext` para ser pure-testable. Mesmo contrato
 * que a expressão inline original; substitui sem mudança de comportamento.
 */

export interface ComputeNeedsDeepLinkResolveArgs {
  /** `true` quando a URL trouxe `?phone=`. */
  hasDeepLinkPhone: boolean;
  /** `true` depois que o deep-link já foi consumido (não rodar de novo). */
  deepLinkProcessed: boolean;
  /** Quantidade de instâncias permitidas ao usuário corrente. */
  instancesCount: number;
  /** Valor de `?instance=` na URL (null/empty quando ausente). */
  deepLinkInstance: string | null | undefined;
  /** IDs de instância permitidas (já filtrados por tenancy). */
  allowedInstanceIds: ReadonlyArray<string>;
}

export function computeNeedsDeepLinkResolve(
  args: ComputeNeedsDeepLinkResolveArgs,
): boolean {
  const {
    hasDeepLinkPhone,
    deepLinkProcessed,
    instancesCount,
    deepLinkInstance,
    allowedInstanceIds,
  } = args;

  if (!hasDeepLinkPhone) return false;
  if (deepLinkProcessed) return false;
  if (instancesCount === 0) return false;

  // URL trouxe instance válida → pula resolver.
  if (deepLinkInstance && allowedInstanceIds.includes(deepLinkInstance)) {
    return false;
  }

  return true;
}
