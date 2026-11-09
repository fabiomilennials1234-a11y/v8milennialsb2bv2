import { isPipelineVisible, sortPipelinesForNavigation } from "@/modules/pipelines";
import { useMemo } from "react";
import { useFunisDaOrg } from "@/modules/pipelines";

/**
 * Opções de funil para os gráficos de Analytics (SCRUM-631, W3 · Funil é Funil).
 *
 * Substitui as listas fixas de 3 slugs de sistema: os gráficos passam a listar
 * os funis REAIS e ativos da org, com `pipeline_id` como valor — funil custom
 * entra nos números.
 *
 * A seleção inicial do gráfico é local e não atribui preferência à organização.
 */
export interface AnalyticsPipelineOption {
  id: string;
  name: string;
  slug: string;
}

export function useAnalyticsPipelineOptions() {
  // Nome canônico escolhido pela organização.
  const { data: pipelines, isLoading } = useFunisDaOrg();

  return useMemo(() => {
    const active = sortPipelinesForNavigation(pipelines ?? []).filter((p) => p.is_active && isPipelineVisible(p));
    const options: AnalyticsPipelineOption[] = active.map((p) => ({
      id: p.id,
      name: p.label,
      slug: p.slug,
    }));
    const orgDefault = options[0]?.id ?? null;
    const closingDefault = orgDefault;
    return { options, orgDefault, closingDefault, isLoading };
  }, [pipelines, isLoading]);
}
