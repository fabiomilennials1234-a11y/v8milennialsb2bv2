import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { SavedView, SavedViewInsert, SavedViewUpdate } from "@/types/saved-views";

export function useSavedViews(entityType: string) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["saved_views", organizationId, entityType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_views" as any)
        .select("*")
        .eq("entity_type", entityType)
        .order("is_system", { ascending: false })
        .order("position", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as SavedView[];
    },
    enabled: !!organizationId && !!entityType,
  });
}

export function useCreateSavedView() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (input: SavedViewInsert) => {
      const { data, error } = await supabase
        .from("saved_views" as any)
        .insert({
          ...input,
          organization_id: organizationId,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as SavedView;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["saved_views", organizationId, variables.entity_type],
      });
    },
  });
}

export function useUpdateSavedView() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({
      id,
      entityType,
      ...updates
    }: SavedViewUpdate & { id: string; entityType: string }) => {
      const { data, error } = await supabase
        .from("saved_views" as any)
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as SavedView;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["saved_views", organizationId, variables.entityType],
      });
    },
  });
}

export function useDeleteSavedView() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({
      id,
      entityType,
    }: {
      id: string;
      entityType: string;
    }) => {
      const { error } = await supabase
        .from("saved_views" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["saved_views", organizationId, variables.entityType],
      });
    },
  });
}
