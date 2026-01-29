/**
 * Hook para verificação de acesso ao Copilot
 *
 * Verifica se o usuário tem subscription ativa para usar o Copilot.
 * Admins têm acesso completo mesmo sem subscription ativa.
 */

import { useQuery } from "@tanstack/react-query";
import { checkCurrentUserSubscription } from "@/lib/subscription";
import { useIsAdmin } from "@/hooks/useUserRole";

/**
 * Verifica se o usuário tem acesso ao Copilot
 *
 * Regra: 
 * - Admins têm acesso completo (mesmo sem subscription)
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
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const { data: subscription, isLoading: subLoading } = useQuery({
    queryKey: ["subscription", "copilot"],
    queryFn: async () => {
      const sub = await checkCurrentUserSubscription();
      return sub;
    },
    staleTime: 5 * 60 * 1000, // Cache por 5 minutos
    refetchOnWindowFocus: true, // Revalidar quando usuário volta ao app
  });

  const isLoading = adminLoading || subLoading;

  // Admins têm acesso completo, outros precisam de subscription ativa
  const hasAccess = isAdmin || 
    (subscription?.isValid === true && subscription?.status === "active");
  const isTrial = !isAdmin && subscription?.status === "trial";

  return {
    hasAccess,
    isTrial,
    isLoading,
    subscription,
  };
}
