import { useMemo } from "react";
import { useFunisAtivosDaOrg } from "@/modules/pipelines";
import { useOrgFunnelStages } from "./useOrgFunnelStages";

export interface PipeTypeOption {
  /** Referência persistida: slug histórico para seeds; UUID para os demais. */
  value: string;
  label: string;
  pipelineId?: string;
  slug?: string;
}

export interface CopilotFunnelOptions {
  options: PipeTypeOption[];
  stagesByPipe: Record<string, { value: string; label: string }[]>;
  labelForRef: (ref: string) => string;
  isLoading: boolean;
}

const LEGACY_ALIASES: Record<string, string> = {
  qualificacao: "whatsapp",
  pipe_whatsapp: "whatsapp",
  pipe_confirmacao: "confirmacao",
  pipe_propostas: "propostas",
};

/**
 * Catálogo canônico usado por todas as telas do Copilot.
 *
 * A fonte é `pipelines` + `pipeline_stages`; qualquer funil ativo da
 * organização aparece com o mesmo comportamento. O valor persistido mantém o
 * contrato já publicado: seeds históricos usam slug e funis criados pela org
 * usam UUID. Leitura aceita UUID, slug e aliases antigos.
 */
export function useCopilotFunnelOptions(
  opts: { incluirCampanha?: boolean } = {},
): CopilotFunnelOptions {
  const { incluirCampanha = true } = opts;
  const { data: funnels, isLoading: loadingFunnels } = useFunisAtivosDaOrg();
  const { byPipelineId, isLoading: loadingStages } = useOrgFunnelStages();

  return useMemo(() => {
    const funnelOptions: PipeTypeOption[] = funnels.map((funnel) => ({
      value: funnel.type === "system" ? funnel.slug : funnel.id,
      label: funnel.label,
      pipelineId: funnel.id,
      slug: funnel.slug,
    }));
    const options = incluirCampanha
      ? [...funnelOptions, { value: "campanha", label: "Campanhas" }]
      : funnelOptions;

    const stagesByPipe: Record<string, { value: string; label: string }[]> = {};
    for (const option of funnelOptions) {
      const stages = (byPipelineId.get(option.pipelineId!) ?? []).map((stage) => ({
        value: stage.stage_key,
        label: stage.name,
      }));
      stagesByPipe[option.value] = stages;
      stagesByPipe[option.pipelineId!] = stages;
      stagesByPipe[option.slug!] = stages;
    }

    const labelForRef = (rawRef: string) => {
      const ref = rawRef.trim().toLowerCase();
      if (ref === "campanha") return "Campanhas";
      const canonical = LEGACY_ALIASES[ref] ?? ref;
      return funnelOptions.find(
        (option) =>
          option.value.toLowerCase() === canonical ||
          option.pipelineId?.toLowerCase() === canonical ||
          option.slug?.toLowerCase() === canonical,
      )?.label ?? rawRef;
    };

    return {
      options,
      stagesByPipe,
      labelForRef,
      isLoading: loadingFunnels || loadingStages,
    };
  }, [byPipelineId, funnels, incluirCampanha, loadingFunnels, loadingStages]);
}

/** Compatibilidade para consumidores que precisam somente da lista. */
export function usePipeTypeOptions(
  opts: { incluirCampanha?: boolean } = {},
): PipeTypeOption[] {
  return useCopilotFunnelOptions(opts).options;
}
