import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useRealtimeSubscription(
  table: string,
  queryKeys: string[]
) {
  const queryClient = useQueryClient();
  // Manter referência estável das queryKeys para evitar subscribe/unsubscribe
  // constante no useEffect (arrays criam referência nova a cada render)
  const queryKeysRef = useRef(queryKeys);
  queryKeysRef.current = queryKeys;

  // Serializar para usar como dependência estável
  const queryKeysKey = JSON.stringify(queryKeys);

  useEffect(() => {
    const channel = supabase
      .channel(`${table}_realtime`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          queryKeysRef.current.forEach((key) => {
            queryClient.invalidateQueries({ queryKey: [key] });
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, queryClient, queryKeysKey]);
}
