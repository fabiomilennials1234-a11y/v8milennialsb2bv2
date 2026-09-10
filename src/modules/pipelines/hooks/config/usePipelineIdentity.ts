import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Identidade visual de QUALQUER funil — nome, ícone e cor (SCRUM-636, D4).
 *
 * Escreve em `pipelines.name/icon/color`, a linha canônica do funil. O banco
 * mantém `pipeline_display_config` como espelho transitório para leitores
 * antigos; a interface não escreve nem decide nomes por ele.
 */
export function useUpdatePipelineIdentity() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({
      id,
      name,
      icon,
      color,
    }: {
      id: string;
      slug: string;
      type: "system" | "custom";
      name: string;
      icon: string;
      color: string;
    }) => {
      if (!organizationId) throw new Error("Organização não encontrada");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("O nome do funil não pode ficar vazio");

      // `pipelines` ainda não está no types.ts gerado com update tipado por
      // aqui — mesmo cast pontual de `usePipelines`.
      const { data, error } = await (supabase.from as any)("pipelines")
        .update({ name: trimmed, icon, color, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select("id")
        .single();

      if (error) throw error;
      if (!data) throw new Error("Funil não encontrado nesta organização");

      return { id, name: trimmed, icon, color };
    },
    onSuccess: () => {
      // Todo cache que carrega o NOME de um funil. `custom_pipelines` é view
      // sobre `pipelines` (D5), então o rename de um funil custom chega nela
      // sozinho — o que falta é mandar refazer a leitura.
      //   · `pipelines` .............. registro único (hub, lateral, quadro)
      //   · `pipeline-display-config`  adaptador de leitores legados
      //   · `custom_pipelines` ....... prefixo: cobre permanent/temporary/active
      //   · `custom_pipeline` ........ funil aberto, por slug
      //   · `lead_all_pipelines` ..... os funis do lead, no painel dele
      for (const key of [
        "pipelines",
        "pipeline-display-config",
        "custom_pipelines",
        "custom_pipeline",
        "lead_all_pipelines",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
