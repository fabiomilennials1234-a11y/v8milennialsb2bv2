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
 * - `closingDefault`: default dos gráficos de venda (velocity / ciclo de
 *   vendas) — preserva o comportamento legado que abria em "Propostas":
 *   o funil de slug 'propostas' enquanto existir; senão, `orgDefault`.
 */
export interface AnalyticsPipelineOption {
  id: string;
  name: string;
  slug: string;
}

export function useAnalyticsPipelineOptions() {
  // Nome que a ORG usa — `pipelines.name` é o seed congelado no sistema.
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
    const closingDefault = active.find((p) => p.slug === "propostas")?.id ?? orgDefault;
    return { options, orgDefault, closingDefault, isLoading };
  }, [pipelines, defaultPipelineId, isLoading]);
}
