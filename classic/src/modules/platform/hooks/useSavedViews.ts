import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type {
  SavedView,
  SavedViewEntityType,
  SavedViewInsert,
  SavedViewUpdate,
} from "@/types/saved-views";

/**
 * Views salvas de uma entidade. Pra funil, o entityType canônico é
 * `pipeline:{uuid}` — construa com `pipelineEntityType(pipelineId)` de
 * `@/types/saved-views`. Slug legado ("pipe_whatsapp") segue aceito só como
 * fallback de leitura pós-migração 20270909001000: devolve as views órfãs
 * que ela não pôde resolver, ou lista vazia.
 */
export function useSavedViews(entityType: SavedViewEntityType) {
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
    }: SavedViewUpdate & { id: string; entityType: SavedViewEntityType }) => {
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
    // `entityType` não entra no delete — existe no shape só pro onSuccess
    // invalidar a queryKey certa via `variables`.
    mutationFn: async ({ id }: { id: string; entityType: SavedViewEntityType }) => {
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
