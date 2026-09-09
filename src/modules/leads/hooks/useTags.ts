import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { useOrganization } from "@/modules/identity";
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
    /**
     * `organization_id` é OPCIONAL aqui, e o tipo agora diz isso.
     *
     * A linha abaixo sempre teve o recuo (`?? organizationId`) e o único
     * chamador de produção — `Configuracoes.tsx:170` — sempre passou só
     * `{ name, color }`. O parâmetro tipado como `TagInsert` (que exige
     * `organization_id: string`) descrevia um contrato que ninguém cumpria:
     * obrigava cada nova tela a repetir uma consulta de org que este hook já
     * faz, ou a mentir com um `as`.
     */
    mutationFn: async (tag: Omit<TagInsert, "organization_id"> & { organization_id?: string }) => {
      // `tags.organization_id` é NOT NULL e a policy de INSERT compara com
      // `get_user_organization_id()`. Sem org conhecida o INSERT seria recusado
      // pelo banco com uma mensagem sobre RLS — que descreve o sintoma e esconde
      // a causa. Falhar aqui diz a verdade.
      const orgId = tag.organization_id ?? organizationId;
      if (!orgId) throw new Error("Organização não identificada — não é possível criar a etiqueta.");

      const { data, error } = await supabase
        .from("tags")
        .insert({ ...tag, organization_id: orgId })
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
