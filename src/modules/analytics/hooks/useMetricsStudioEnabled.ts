import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Trava de liberação do Estúdio de Métricas — G5 do grill de 2026-08-11.
 *
 * Independente de `composable_metrics_enabled` de propósito: aquela flag
 * dispara o re-seed da TV (2 páginas + 13 widgets) ao ser ligada, então
 * reusá-la trocaria a TV do cliente que pediu só Métricas.
 *
 * FALHA PARA FECHADO. Erro de rede, coluna ainda não aplicada em prod, org
 * indefinida — tudo devolve `false` e a tela fica indisponível. É o oposto do
 * fail-safe do irmão `useComposableMetricsEnabled`, e de propósito: lá a falha
 * cai na TV legada (que existe e funciona); aqui não há legado para cair, e
 * mostrar a tela sem confirmar a liberação seria expor a feature a org que não
 * foi escolhida.
 *
 * Consequência operacional: enquanto a migration `20270811100000` não estiver
 * em PROD, o Estúdio fica invisível para todo mundo. É o comportamento
 * desejado — a tela não vaza antes da hora.
 */
export function useMetricsStudioEnabled() {
  const { organizationId, isReady } = useOrganization();

  const query = useQuery({
    queryKey: ["metrics-studio-enabled", organizationId],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("organizations")
        .select("metrics_studio_enabled")
        .eq("id", organizationId!)
        .maybeSingle();
      // Coluna ausente devolve 42703/PGRST204. Não distinguimos do resto: em
      // qualquer erro a resposta é a mesma, negar.
      if (error) return false;
      return Boolean((data as { metrics_studio_enabled?: boolean } | null)?.metrics_studio_enabled);
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  return {
    /** Só `true` quando a org está comprovadamente liberada. */
    enabled: query.data === true,
    /** Enquanto resolve, a tela não decide nada — nem mostra, nem nega. */
    isLoading: !isReady || query.isLoading,
  };
}
