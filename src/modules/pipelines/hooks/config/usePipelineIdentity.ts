import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Identidade visual de QUALQUER funil — nome, ícone e cor (SCRUM-636, D4).
 *
 * Escreve em `pipelines.name/icon/color`, a linha canônica do funil (Wave 1
 * deu as colunas a todos). Para funil de SISTEMA, sincroniza também
 * `pipeline_display_config.display_name`, porque navegação e hub renderizam o
 * nome do funil de sistema a partir do REGISTRO, não do espelho.
 *
 * ── Precedência name vs display_name (documentada aqui de propósito) ────────
 *   · Funil com linha em `pipeline_display_config` (= sistema): o que renderiza
 *     é `display_name` — ele VENCE onde existir (navegação, hub, Zona de
 *     Perigo). `pipelines.name` é o canônico rumo à unificação (W6); esta
 *     mutation mantém os dois IGUAIS a partir de agora, então a precedência só
 *     importa para divergência histórica (org que renomeou via registro antes
 *     desta tela existir: prevalece o display_name dela até o próximo rename).
 *   · Funil sem registro (= custom): `pipelines.name` é a única fonte.
 */
export function useUpdatePipelineIdentity() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({
      id,
      slug,
      type,
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

      // Sistema: o nome exibido vem do registro — sincroniza para a navegação
      // e o hub refletirem o rename imediatamente (precedência acima).
      if (type === "system") {
        const { error: configError } = await supabase
          .from("pipeline_display_config")
          .update({ display_name: trimmed, updated_at: new Date().toISOString() })
          .eq("organization_id", organizationId)
          .eq("pipe_type", slug);
        if (configError) throw configError;
      }

      return { id, name: trimmed, icon, color };
    },
    onSuccess: () => {
      // Todo cache que carrega o NOME de um funil. `custom_pipelines` é view
      // sobre `pipelines` (D5), então o rename de um funil custom chega nela
      // sozinho — o que falta é mandar refazer a leitura.
      //   · `pipelines` .............. registro único (hub, lateral, quadro)
      //   · `pipeline-display-config`  nome do funil de sistema (vence)
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
