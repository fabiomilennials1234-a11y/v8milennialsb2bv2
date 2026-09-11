import { useMemo } from "react";
import { useFunisDaOrg } from "@/modules/pipelines";
import { useOrganizationSettings } from "@/modules/identity";

/**
 * Opções de funil para os gráficos de Analytics (SCRUM-631, W3 · Funil é Funil).
 *
 * Substitui as listas fixas de 3 slugs de sistema: os gráficos passam a listar
 * os funis REAIS e ativos da org, com `pipeline_id` como valor — funil custom
 * entra nos números.
 *
 * Defaults (documentados na spec F3):
 * - `orgDefault`: o funil padrão da org (SCRUM-624, organizations.default_pipeline_id);
 *   se a org não tem padrão (ou ele está inativo), o primeiro funil da lista.
 * - `closingDefault`: segue o funil padrão escolhido pela organização. O slug
 *   técnico de um seed antigo não define mais comportamento de produto.
 */
export interface AnalyticsPipelineOption {
  id: string;
  name: string;
  slug: string;
}

export function useAnalyticsPipelineOptions() {
  // Nome canônico escolhido pela organização.
  const { data: pipelines, isLoading } = useFunisDaOrg();
  const { settings } = useOrganizationSettings();
  const defaultPipelineId = settings.default_pipeline_id;

  return useMemo(() => {
    const active = (pipelines ?? []).filter((p) => p.is_active);
    const options: AnalyticsPipelineOption[] = active.map((p) => ({
      id: p.id,
      name: p.label,
      slug: p.slug,
    }));
    const orgDefault =
      defaultPipelineId && active.some((p) => p.id === defaultPipelineId)
        ? defaultPipelineId
        : options[0]?.id ?? null;
    const closingDefault = orgDefault;
    return { options, orgDefault, closingDefault, isLoading };
  }, [pipelines, defaultPipelineId, isLoading]);
}
