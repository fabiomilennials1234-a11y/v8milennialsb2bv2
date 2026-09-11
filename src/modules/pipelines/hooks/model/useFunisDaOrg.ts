import { useMemo } from "react";
import { usePipelines, type Pipeline } from "./usePipelines";

/**
 * Os funis da organização **com o nome que ela usa**.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 * `pipelines` é o registro único de funis (ADR-0034). `type` registra apenas a
 * procedência do seed e não muda comportamento ou nome. Assim, `name` e
 * `label` sempre representam o nome escolhido pelo usuário.
 *
 * ── O QUE ESTE HOOK GARANTE ─────────────────────────────────────────────────
 * 1. **Só os funis que a org TEM.** A fonte é `pipelines`, filtrada por
 *    organização pela RLS — nada de catálogo em memória. Funil que a org
 *    excluiu não volta.
 * 2. **O nome que a org usa.** `label` é `pipelines.name` para todos.
 *
 * `label` mantém a API dos seletores, mas tem exatamente o mesmo valor de
 * `name`; não existe mais uma segunda fonte de nome na interface.
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

  const data = useMemo(
    () =>
      pipelines.map((p) => ({
        ...p,
        label: p.name,
      })),
    [pipelines],
  );

  return {
    data,
    isLoading: pipelinesLoading,
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
