import { useTemporaryFunnels } from "../hooks/custom/useCustomPipelines";
import { usePipelines } from "../hooks/model/usePipelines";

/**
 * Cor de fallback quando a linha de `pipelines` ainda não chegou (ou o funil
 * não tem cor gravada). As cores REAIS vêm de `pipelines.color` — funil de
 * sistema persiste cor/ícone como qualquer outro (SCRUM-637; morreu o
 * `FUNNEL_COLOR_MAP` hardcoded que ignorava a personalização).
 */
export const FUNNEL_FALLBACK_COLOR = "#64748b";

export type FunnelGroup = "custom" | "prazo";

/** O que a identidade do funil precisa da linha canônica de `pipelines`. */
export interface FunnelCanonicalRow {
  id: string;
  slug: string;
  type: "system" | "custom";
  name: string;
  icon: string;
  color: string;
}

export interface FunnelOption {
  /** Estável por funil: `pipeline:<id>`. */
  key: string;
  label: string;
  color: string;
  path: string;
  group: FunnelGroup;
  /** Funil com prazo já encerrado — listado por último e esmaecido. */
  ended?: boolean;
  /**
   * Linha canônica em `pipelines` — a mesma que a aba "Geral" edita. Vem
   * junto porque o seletor é o único lugar do quadro que sabe QUAL funil está
   * aberto e como ele se chama para o usuário; sem isso, quem quisesse
   * renomear a partir do cabeçalho teria de reassinar `usePipelines` (e uma
   * segunda inscrição de Realtime na mesma tela). Ausente enquanto o registro
   * não chegou.
   */
  pipeline?: FunnelCanonicalRow;
}

/**
 * Lista única de funis. `type` e os slugs antigos não alteram visibilidade,
 * nome nem comportamento; o UUID identifica e `pipelines.name` apresenta.
 */
export function useFunnelOptions(): { options: FunnelOption[]; isLoading: boolean } {
  const { data: temporary = [], isLoading: temporaryLoading } = useTemporaryFunnels();
  // Registro único: é daqui que saem cor (e ícone) REAIS de qualquer funil —
  // funil de sistema personalizado deixa de aparecer com a cor de fábrica.
  const { data: pipelines = [], isLoading: pipelinesLoading } = usePipelines();
  const temporaryById = new Map(temporary.map((p) => [p.id, p] as const));
  const options: FunnelOption[] = pipelines
    .filter((pipeline) => pipeline.is_active || temporaryById.get(pipeline.id)?.status === "ended")
    .map((pipeline) => ({
      key: `pipeline:${pipeline.id}`,
      label: pipeline.name,
      color: pipeline.color ?? FUNNEL_FALLBACK_COLOR,
      path: `/funil/${pipeline.slug}`,
      group: temporaryById.has(pipeline.id) ? "prazo" : "custom",
      ended: temporaryById.get(pipeline.id)?.status === "ended",
      pipeline,
    }));

  return {
    options,
    isLoading: pipelinesLoading || temporaryLoading,
  };
}
