import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { useOrganization } from "./useOrganization";

export type Tag = Tables<"tags">;
export type TagInsert = TablesInsert<"tags">;
export type TagUpdate = TablesUpdate<"tags">;

export function useTags() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["tags", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("tags")
        .select("*")
        .eq("organization_id", organizationId)
        .order("name");

      if (error) throw error;
      return data as Tag[];
    },
    enabled: isReady,
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (tag: TagInsert) => {
      const { data, error } = await supabase
        .from("tags")
        .insert({ ...tag, organization_id: tag.organization_id ?? organizationId })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}

export function useUpdateTag() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: TagUpdate & { id: string }) => {
      const { data, error } = await supabase
        .from("tags")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}

export function useDeleteTag() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("tags")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}
