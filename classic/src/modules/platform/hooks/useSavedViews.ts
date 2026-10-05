import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useOrganization } from "@/modules/identity";
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
  const { user } = useAuth();

  return useQuery({
    queryKey: ["saved_views", organizationId, user?.id, entityType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_views" as any)
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("entity_type", entityType)
        .order("is_system", { ascending: false })
        .order("position", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as SavedView[];
    },
    enabled: !!organizationId && !!user && !!entityType,
  });
}

export function useCreateSavedView() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: SavedViewInsert) => {
      if (!user) throw new Error("Entre de novo para salvar a view.");
      if (!organizationId) throw new Error("Selecione uma organização para salvar a view.");
      const { data, error } = await supabase
        .from("saved_views" as any)
        .insert({
          ...input,
          organization_id: organizationId,
          owner_id: user.id,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as SavedView;
    },
    onSuccess: (view) => {
      queryClient.invalidateQueries({
        queryKey: ["saved_views", view.organization_id],
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
      if (!organizationId) throw new Error("Selecione uma organização para editar a view.");
      const { data, error } = await supabase
        .from("saved_views" as any)
        .update(updates as any)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as SavedView;
    },
    onSuccess: (view) => {
      queryClient.invalidateQueries({
        queryKey: ["saved_views", view.organization_id],
      });
    },
  });
}

export function useDeleteSavedView() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    // Mantém entityType no contrato dos chamadores; a invalidação cobre a org.
    mutationFn: async ({ id }: { id: string; entityType: SavedViewEntityType }) => {
      if (!organizationId) throw new Error("Selecione uma organização para excluir a view.");
      const { error } = await supabase
        .from("saved_views" as any)
        .delete()
        .eq("id", id)
        .eq("organization_id", organizationId);
      if (error) throw error;
      return organizationId;
    },
    onSuccess: (deletedOrganizationId) => {
      queryClient.invalidateQueries({
        queryKey: ["saved_views", deletedOrganizationId],
      });
    },
  });
}
