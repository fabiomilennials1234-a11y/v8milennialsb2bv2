import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useCanDo, useCurrentTeamMember, useOrganization } from "@/modules/identity";
import { mapearResumo, type ResumoSemana } from "../lib/boas-vindas-semana";

/**
 * O resumo da semana anterior da org do usuário, entregue UMA vez por semana.
 *
 * ── CHAMAR CONSOME A SEMANA ──────────────────────────────────────────────────
 * `boas_vindas_semana_reivindicar` marca "já viu" no mesmo instante em que
 * entrega. Por isso a chamada só acontece quando a abertura VAI poder aparecer:
 *
 *   · `metrics.view` — a permissão que tranca a tela de Métricas. Quem não pode
 *     ver receita no painel não vê receita na abertura, e nada é consumido.
 *
 * Master e gestor de portfólio também recebem: entram como admin (membro
 * virtual) e ganham a abertura uma vez por org, por semana, como qualquer usuário.
 *
 * O resultado fica em cache para sempre na sessão: refazer a chamada devolveria
 * `ja_vista` e apagaria da tela uma abertura que está tocando.
 */
export function useBoasVindasSemana() {
  const { user } = useAuth();
  const { organizationId, isReady } = useOrganization();
  const { data: membro } = useCurrentTeamMember();
  const podeVerMetricas = useCanDo("metrics.view");

  const habilitado = Boolean(
    user?.id && isReady && organizationId && membro && !podeVerMetricas.isLoading && podeVerMetricas.allowed,
  );

  return useQuery<ResumoSemana | null>({
    queryKey: ["boas-vindas-semana", user?.id, organizationId],
    enabled: habilitado,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "boas_vindas_semana_reivindicar" as never,
        { p_org_id: organizationId } as never,
      );
      if (error) {
        // Decoração nunca vira erro na cara do usuário: sem animação, e só.
        console.error("[boas-vindas-semana] falha ao reivindicar:", error.message);
        return null;
      }
      return mapearResumo(data);
    },
  });
}
