import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { OBSERVED_FIELDS } from "../lib/condition-field-controls";

/** Suggestions from visible leads; never invent urgency or segment enums. */
export function useOrgConditionValues(field: string | undefined) {
  const { organizationId, isReady } = useOrganization();
  const enabled = isReady && !!organizationId && !!field && OBSERVED_FIELDS.has(field);
  const query = useQuery({
    queryKey: ["org-condition-values", organizationId, field],
    enabled,
    queryFn: async () => {
      if (!organizationId || !field || !OBSERVED_FIELDS.has(field)) return [];
      const { data, error } = await supabase.from("leads").select(field)
        .eq("organization_id", organizationId).not(field, "is", null).neq(field, "").limit(1000);
      if (error) throw error;
      return [...new Set((data as unknown as Record<string, unknown>[] ?? [])
        .map((row) => row[field]).filter((value): value is string => typeof value === "string" && value.trim().length > 0))]
        .sort((a, b) => a.localeCompare(b, "pt-BR"));
    },
    staleTime: 60_000,
  });
  return { values: query.data ?? [], isLoading: enabled && query.isLoading, isError: query.isError };
}
