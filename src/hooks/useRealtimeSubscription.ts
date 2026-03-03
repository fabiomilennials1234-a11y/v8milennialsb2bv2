import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";

/**
 * Debounce de 2 segundos para evitar cascade de invalidações
 * quando múltiplas mudanças chegam em sequência (ex: bulk update de leads)
 */
const DEBOUNCE_MS = 2000;

/**
 * Tabelas que NÃO têm coluna organization_id — usam wildcard.
 * Todas as outras são filtradas por org_id para reduzir ~80% do tráfego realtime.
 */
const TABLES_WITHOUT_ORG_ID = new Set([
  "team_members",
  "user_roles",
  "profiles",
  "master_users",
  "tags",
]);

export function useRealtimeSubscription(
  table: string,
  queryKeys: string[]
) {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  // Manter referência estável das queryKeys para evitar subscribe/unsubscribe
  // constante no useEffect (arrays criam referência nova a cada render)
  const queryKeysRef = useRef(queryKeys);
  queryKeysRef.current = queryKeys;
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staggerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Serializar para usar como dependência estável
  const queryKeysKey = JSON.stringify(queryKeys);

  useEffect(() => {
    // Filtrar por organization_id quando a tabela suporta
    const canFilter = !TABLES_WITHOUT_ORG_ID.has(table) && !!organizationId;

    const channelName = `${table}_realtime_${organizationId ?? "global"}`;

    const pgChangesConfig: Record<string, string> = {
      event: "*",
      schema: "public",
      table,
    };

    if (canFilter) {
      pgChangesConfig.filter = `organization_id=eq.${organizationId}`;
    }

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        pgChangesConfig as any,
        () => {
          // Debounce: agrupa múltiplas mudanças em sequência numa única invalidação
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
          }
          debounceTimerRef.current = setTimeout(() => {
            const keys = queryKeysRef.current;
            if (keys.length > 0) {
              // Invalidar a primeira key imediatamente (dados primários da tabela)
              queryClient.invalidateQueries({ queryKey: [keys[0]] });

              // Stagger: invalidar keys secundárias (métricas, dashboards)
              // após 2s para não sobrecarregar o DB com refetches simultâneos
              if (keys.length > 1) {
                if (staggerTimerRef.current) {
                  clearTimeout(staggerTimerRef.current);
                }
                staggerTimerRef.current = setTimeout(() => {
                  keys.slice(1).forEach((key) => {
                    queryClient.invalidateQueries({ queryKey: [key] });
                  });
                  staggerTimerRef.current = null;
                }, DEBOUNCE_MS);
              }
            }
            debounceTimerRef.current = null;
          }, DEBOUNCE_MS);
        }
      )
      .subscribe();

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (staggerTimerRef.current) {
        clearTimeout(staggerTimerRef.current);
      }
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, queryClient, queryKeysKey, organizationId]);
}
