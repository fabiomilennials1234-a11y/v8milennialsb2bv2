import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Debounce de 2 segundos para evitar cascade de invalidações
 * quando múltiplas mudanças chegam em sequência (ex: bulk update de leads)
 */
const DEBOUNCE_MS = 2000;

export function useRealtimeSubscription(
  table: string,
  queryKeys: string[]
) {
  const queryClient = useQueryClient();
  // Manter referência estável das queryKeys para evitar subscribe/unsubscribe
  // constante no useEffect (arrays criam referência nova a cada render)
  const queryKeysRef = useRef(queryKeys);
  queryKeysRef.current = queryKeys;
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Serializar para usar como dependência estável
  const queryKeysKey = JSON.stringify(queryKeys);

  useEffect(() => {
    const channel = supabase
      .channel(`${table}_realtime`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          // Debounce: agrupa múltiplas mudanças em sequência numa única invalidação
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
          }
          debounceTimerRef.current = setTimeout(() => {
            queryKeysRef.current.forEach((key) => {
              queryClient.invalidateQueries({ queryKey: [key] });
            });
            debounceTimerRef.current = null;
          }, DEBOUNCE_MS);
        }
      )
      .subscribe();

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, queryClient, queryKeysKey]);
}
