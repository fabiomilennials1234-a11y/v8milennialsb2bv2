import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useRealtimeSubscription(
  table: string,
  queryKeys: string[]
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel(`${table}_realtime`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          queryKeys.forEach((key) => {
            queryClient.invalidateQueries({ queryKey: [key] });
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, queryClient, queryKeys]);
}
