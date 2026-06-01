import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AttachedLeadTag {
  id: string; // lead_tags.id
  tag_id: string;
  tag: {
    id: string;
    name: string;
    color: string | null;
  };
}

/**
 * Read tags attached to a lead via the lead_tags junction table.
 */
export function useLeadTagsAttached(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ["lead-tags", leadId],
    enabled: !!leadId,
    staleTime: 30_000,
    queryFn: async (): Promise<AttachedLeadTag[]> => {
      if (!leadId) return [];
      const { data, error } = await supabase
        .from("lead_tags")
        .select("id, tag_id, tag:tags(id, name, color)")
        .eq("lead_id", leadId);
      if (error) throw error;
      return (data ?? []) as AttachedLeadTag[];
    },
  });
}

export function useAddLeadTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, tagId }: { leadId: string; tagId: string }) => {
      const { data, error } = await supabase
        .from("lead_tags")
        .insert({ lead_id: leadId, tag_id: tagId })
        .select("id, tag_id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["lead-tags", vars.leadId] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead-timeline", vars.leadId] });
    },
  });
}

export function useRemoveLeadTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadTagId, leadId }: { leadTagId: string; leadId: string }) => {
      const { error } = await supabase.from("lead_tags").delete().eq("id", leadTagId);
      if (error) throw error;
      return { leadId };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["lead-tags", vars.leadId] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead-timeline", vars.leadId] });
    },
  });
}
