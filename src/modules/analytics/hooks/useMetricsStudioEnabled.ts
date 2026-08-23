import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { IS_DEMO_MODE } from "@/core/demo-mode";

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

  // A consulta só existe quando há org para consultar. Sem isso, `isLoading`
  // do TanStack fica pendente para sempre numa query desabilitada — foi o que
  // travou a tela no spinner durante a verificação em modo demo.
  const ativa = isReady && !!organizationId;

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
    enabled: ativa,
    staleTime: 5 * 60 * 1000,
  });

  return {
    // Modo demonstração libera a tela: sem sessão não há org, e sem org a
    // trava negaria tudo, tornando a tela impossível de revisar. Em produção
    // `IS_DEMO_MODE` é a constante `false` e o ramo some do bundle.
    enabled: IS_DEMO_MODE || query.data === true,
    /**
     * Só é "carregando" enquanto a consulta está de fato no ar. Sem org a
     * query nunca roda, e reportar carregando ali deixaria a tela num spinner
     * eterno em vez de dizer que não está liberada.
     */
    isLoading: ativa && query.isLoading,
  };
}
