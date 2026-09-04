import { useMemo } from "react";
import { nomeDoFunil, type SystemPipeDisplay } from "@/contracts/pipe";
import { usePipelineDisplayConfig } from "../config/usePipelineDisplayConfig";
import { usePipelines, type Pipeline } from "./usePipelines";

/**
 * Os funis da organização **com o nome que ela usa**.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 * `usePipelines()` devolve o registro cru, e para funil de SISTEMA o
 * `pipelines.name` é o seed congelado de `create_default_pipelines()` —
 * "Qualificação", "Confirmação", "Propostas". Ninguém vê esses nomes na
 * navegação: quem manda é `pipeline_display_config.display_name`, que é o que
 * a org renomeia. Renderizar `p.name` cru mostra ao usuário um nome que o
 * resto do produto não usa (SCRUM-608).
 *
 * A regra correta já existia — `nomeDoFunil`, em `contracts/pipe` — mas só
 * três telas passavam por ela. As outras liam `p.name` direto, e uma
 * (`useInboxFunnelOptions`) reescrevia a regra à mão como
 * `cfg?.display_name ?? p.name`. Rótulo de funil tinha, na prática, três
 * versões diferentes no mesmo produto.
 *
 * Medido no PROD em 2026-09-04: **as 106 orgs têm o trio de sistema**
 * (`whatsapp`/`confirmacao`/`propostas`). Ou seja, toda tela que renderizava o
 * nome cru mostrava "Qualificação/Confirmação/Propostas" para todo mundo —
 * inclusive para a org que renomeou os três.
 *
 * ── O QUE ESTE HOOK GARANTE ─────────────────────────────────────────────────
 * 1. **Só os funis que a org TEM.** A fonte é `pipelines`, filtrada por
 *    organização pela RLS — nada de catálogo em memória. Funil que a org
 *    excluiu não volta.
 * 2. **O nome que a org usa.** `label` vem de `nomeDoFunil`: `display_name`
 *    para sistema, `pipelines.name` para custom (ali o nome já é do usuário).
 *
 * `label` é campo NOVO, ao lado de `name` — quem precisa do valor cru (uma
 * migration, um log, uma chave) continua tendo. Quem desenha na tela usa
 * `label`.
 */
export interface FunilDaOrg extends Pipeline {
  /** O nome que a organização usa. É este que vai para a tela. */
  label: string;
}

export function useFunisDaOrg(): {
  data: FunilDaOrg[];
  isLoading: boolean;
} {
  const { data: pipelines = [], isLoading: pipelinesLoading } = usePipelines();
  const { data: displayConfigs = [], isLoading: configLoading } = usePipelineDisplayConfig();

  const data = useMemo(
    () =>
      pipelines.map((p) => ({
        ...p,
        label: nomeDoFunil(displayConfigs as SystemPipeDisplay[], p),
      })),
    [pipelines, displayConfigs],
  );

  return {
    data,
    // O display config chegando depois trocaria o rótulo na frente do usuário
    // ("Qualificação" → "Oportunidades"). Enquanto ele carrega, quem consome
    // ainda está carregando.
    isLoading: pipelinesLoading || configLoading,
  };
}

/**
 * Só os funis ATIVOS, que é o que praticamente toda tela de escolha quer.
 *
 * ⚠️ `usePipelines()` NÃO filtra `is_active` — está documentado no CLAUDE.md do
 * módulo engagement e cada consumidor vinha filtrando (ou esquecendo de
 * filtrar) por conta própria.
 */
export function useFunisAtivosDaOrg(): {
  data: FunilDaOrg[];
  isLoading: boolean;
} {
  const { data, isLoading } = useFunisDaOrg();
  const ativos = useMemo(() => data.filter((p) => p.is_active !== false), [data]);
  return { data: ativos, isLoading };
}
