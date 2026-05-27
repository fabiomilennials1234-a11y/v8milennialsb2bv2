import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useTrackView(
  entityType: string | undefined,
  entityId: string | undefined,
  entityLabel?: string | null,
) {
  useEffect(() => {
    if (!entityType || !entityId) return;
    (supabase.rpc as any)("track_recent_view", {
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_entity_label: entityLabel ?? null,
    }).then(({ error }: { error: any }) => {
      if (error) console.warn("track_recent_view failed:", error.message);
    });
  }, [entityType, entityId, entityLabel]);
}
