/**
 * useOrgFunnelStages — etapas ATIVAS de todos os funis da org, com identidade
 * real (`id` + `pipeline_id`), agrupáveis por funil (SCRUM-628).
 *
 * Existe porque a aba de kanban rules precisa do UUID da etapa (formato novo
 * das regras) e os hooks do módulo pipelines devolvem só stage_key/label.
 * Pós-W2 (inversão do silo custom) TODAS as etapas — sistema e custom — vivem
 * em `pipeline_stages` com `pipeline_id` preenchido, então uma query cobre
 * tudo.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

export interface OrgFunnelStage {
  id: string;
  pipeline_id: string;
  stage_key: string;
  name: string;
  position: number;
  stage_role: string;
}

export function useOrgFunnelStages() {
  const { organizationId } = useOrganization();

  const query = useQuery({
    queryKey: ["org-funnel-stages", organizationId],
    queryFn: async (): Promise<OrgFunnelStage[]> => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("id, pipeline_id, stage_key, name, position, stage_role")
        .eq("organization_id", organizationId!)
        .eq("is_active", true)
        .not("pipeline_id", "is", null)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as OrgFunnelStage[];
    },
    enabled: !!organizationId,
    staleTime: 2 * 60_000,
  });

  const byPipelineId = useMemo(() => {
    const map = new Map<string, OrgFunnelStage[]>();
    for (const stage of query.data ?? []) {
      const group = map.get(stage.pipeline_id);
      if (group) group.push(stage);
      else map.set(stage.pipeline_id, [stage]);
    }
    return map;
  }, [query.data]);

  return { ...query, byPipelineId };
}
