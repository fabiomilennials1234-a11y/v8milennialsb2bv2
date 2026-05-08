import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface FieldChange {
  id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
  user_name?: string;
}

export function useFieldChanges(entityType: string, entityId: string | undefined) {
  return useQuery({
    queryKey: ["field_changes", entityType, entityId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_lead_field_changes" as any, {
        p_lead_id: entityId,
      });
      if (error) throw error;
      return (data ?? []) as FieldChange[];
    },
    enabled: !!entityId && entityType === "lead",
  });
}
