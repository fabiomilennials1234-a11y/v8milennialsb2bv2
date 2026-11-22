/**
 * Hook para verificação de acesso ao Copilot
 *
 * Verifica se o usuário tem subscription ativa para usar o Copilot.
 * Admins têm acesso completo mesmo sem subscription ativa.
 */

import { useQuery } from "@tanstack/react-query";
import { subscriptionStatusQueryOptions } from "@/modules/billing/lib/subscription";
import { useCanManageCopilot, useCurrentTeamMember } from "@/modules/identity";
/**
 * Verifica se o usuário tem acesso ao Copilot
 *
 * Regra:
 * - Admins e Vendedores têm acesso completo (mesmo sem subscription)
 * - Outros usuários precisam de subscription status === 'active'
 * - Trial não tem acesso (requer upgrade)
 *
 * @returns {
 *   hasAccess: boolean - true se pode usar o Copilot
 *   isTrial: boolean - true se está em trial (sem acesso)
 *   isLoading: boolean - carregando dados
 *   subscription: SubscriptionStatus | null
 * }
 */
export function useCopilotSubscription() {
  const { canManage, isLoading: adminLoading } = useCanManageCopilot();
  // Org do vínculo atual — a mesma que o guard de rota checa. Mesma chave e
  // mesmas opções (`subscriptionStatusQueryOptions`): com os dois montados sai
  // UMA RPC, não duas (antes: chave própria + `limit 1` sem ordem).
  const { data: teamMember, isLoading: teamMemberLoading } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;
  const { data: subscription = null, isLoading: subLoading } = useQuery(
    subscriptionStatusQueryOptions(organizationId),
  );

  const isLoading = adminLoading || teamMemberLoading || subLoading;

  // Admins e Vendedores têm acesso completo, outros precisam de subscription ativa
  const hasAccess = canManage ||
    (subscription?.isValid === true && subscription?.status === "active");
  const isTrial = !canManage && subscription?.status === "trial";

  return {
    hasAccess,
    isTrial,
    isLoading,
    subscription,
  };
}
