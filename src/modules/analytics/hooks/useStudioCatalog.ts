import { useMemo } from "react";
import {
  ENGINE_METRICS,
  UNIDADE_DA_MEDIDA,
  type EngineMetric,
} from "@/modules/analytics/lib/metrics-studio-engine-map";
import type { MetricUnit } from "@/modules/analytics/lib/metric-vocabulary";
import {
  useMetricCustomDefinitions,
  type MetricCustomApi,
  type MetricCustomDefinition,
} from "./useMetricCustomDefinitions";

/**
 * O catálogo que o Estúdio realmente oferece: o que o motor calcula de fábrica
 * MAIS o que esta organização compôs (Emenda 1 do ADR-0023).
 *
 * Por que um hook e não uma constante: até a fatia 10, `ENGINE_BY_ID` era um
 * `Map` estático montado no import. Métrica personalizada vem do banco, por
 * organização — resolver janela por um mapa estático deixaria toda janela
 * personalizada órfã depois de recarregar a página.
 *
 * O prefixo `custom:` no id do StudioMetric não é enfeite. O id vai para
 * `metrics_studio_panels.layout[].metricId`, ao lado dos ids de fábrica; sem
 * prefixo, uma métrica de fábrica futura chamada como um uuid colidiria — e,
 * mais importante, o prefixo deixa a leitura do painel salvo dizer de onde a
 * janela veio sem consultar o banco.
 */

export const PREFIXO_CUSTOM = "custom:";

export function ehMetricaPersonalizada(metricId: string): boolean {
  return metricId.startsWith(PREFIXO_CUSTOM);
}

export function idDaDefinicao(metricId: string): string {
  return metricId.slice(PREFIXO_CUSTOM.length);
}

export function comoEngineMetric(def: MetricCustomDefinition): EngineMetric {
  return {
    id: `${PREFIXO_CUSTOM}${def.id}`,
    label: def.name,
    measureRef: { kind: "custom", id: def.id },
    // Árvore compõe escalares: o motor devolve `series: null` sempre. Sem
    // seletor de corte, sem gráfico de série — mesma regra da razão.
    cortes: ["total"],
    formatId: def.format_id,
  };
}

export interface StudioCatalog {
  /** Fábrica + personalizadas, na ordem em que a lista lateral mostra. */
  metrics: EngineMetric[];
  byId: Map<string, EngineMetric>;
  personalizadas: MetricCustomDefinition[];
  /** Unidade de uma medida do catálogo fechado — o compositor precisa dela. */
  unidadeDaMedida: (id: string) => MetricUnit | undefined;
  custom: MetricCustomApi;
  isLoading: boolean;
}

export function useStudioCatalog(): StudioCatalog {
  const custom = useMetricCustomDefinitions();

  const metrics = useMemo(
    () => [...ENGINE_METRICS, ...custom.definicoes.map(comoEngineMetric)],
    [custom.definicoes],
  );

  const byId = useMemo(() => new Map(metrics.map((m) => [m.id, m])), [metrics]);

  const unidadeDaMedida = useMemo(
    () => (id: string): MetricUnit | undefined => UNIDADE_DA_MEDIDA[id],
    [],
  );

  return {
    metrics,
    byId,
    personalizadas: custom.definicoes,
    unidadeDaMedida,
    custom,
    isLoading: custom.isLoading,
  };
}
