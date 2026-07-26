import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Flag de rollout da TV montável (#1194/#1207).
 * Desligada = TV de hoje, sem regressão. Ligada = TV montável.
 *
 * Lida da coluna `organizations.composable_metrics_enabled`. Erro ou ausência →
 * `false`: a falha degrada para a TV legada, nunca para a tela vazia.
 */
export function useComposableMetricsEnabled() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["composable-metrics-enabled", organizationId],
    queryFn: async (): Promise<boolean> => {
      // `as any`: a coluna entrou na #1194 e types.ts ainda não foi regenerado.
      const { data, error } = await (supabase as any)
        .from("organizations")
        .select("composable_metrics_enabled")
        .eq("id", organizationId!)
        .maybeSingle();
      if (error) return false;
      return Boolean((data as { composable_metrics_enabled?: boolean } | null)?.composable_metrics_enabled);
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}

export interface DashboardPage {
  id: string;
  title: string;
  position: number;
  rotation_seconds: number;
}

/**
 * Páginas do painel de uma superfície. A ROTAÇÃO entre elas é #1222 — aqui só
 * se lista, em ordem estável, para a casca desenhar a primeira.
 */
export function useDashboardPages(surface: "tv" | "command" = "tv") {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["dashboard-pages", organizationId, surface],
    queryFn: async (): Promise<DashboardPage[]> => {
      // `as any`: dashboard_pages entrou na #1194 e types.ts (auto-gerado) ainda
      // não foi regenerado. Mesmo padrão dos hooks que chamam RPC nova.
      const { data, error } = await (supabase as any)
        .from("dashboard_pages")
        .select("id,title,position,rotation_seconds")
        .eq("organization_id", organizationId!)
        .eq("surface", surface)
        .order("position", { ascending: true });
      if (error) throw new Error(`Dashboard pages failed: ${error.message}`);
      return (data ?? []) as DashboardPage[];
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}
