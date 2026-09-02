/**
 * useFunilMetrics — métricas de cabeçalho de UM funil por `pipeline_id`
 * (SCRUM-633, W4 · Funil é Funil).
 *
 * Substitui a escolha manual entre os 3 hooks hardcoded de `usePipeMetrics`
 * (`usePipeWhatsappMetrics` / `usePipeConfirmacaoMetrics` /
 * `usePipePropostasMetrics`): o chamador passa o id do funil — qualquer funil,
 * sistema ou custom — e recebe:
 *
 *   - `generic`   — SEMPRE: contagens por etapa + won/lost/open + conversão,
 *                   via `get_pipeline_stage_counts_by_id` (motor único da
 *                   20270908003000). Funciona para funil custom, que antes não
 *                   tinha métrica de cabeçalho nenhuma.
 *   - `whatsapp`/`confirmacao`/`propostas` — bloco especializado do slug
 *                   correspondente, quando o funil é um dos 3 de sistema.
 *                   **Wrapper legado (documentado p/ W6)**: esses blocos leem
 *                   as views de compat `pipe_*` (valores de venda, MRR,
 *                   no-show por meeting_date etc.) — não existe RPC por id que
 *                   entregue esses agregados hoje. Quando a W6 derrubar as
 *                   views, os agregados de valor/reunião precisam migrar para
 *                   uma RPC por pipeline_id e estes blocos colapsam no generic.
 *
 * Período: recebe `DateRange | null` — EXATAMENTE o contrato dos hooks
 * legados, então o `MetricsPeriodSelector` existente pluga sem adaptação
 * (host: `getDateRange(periodState)` → cá). No bloco generic o período usa a
 * âncora canônica do motor: `created_at` para etapa aberta e
 * `metrics_period_at` (fallback `updated_at`) para etapa won/lost — as
 * `p_closed_status_keys` são derivadas do `stage_role` das etapas do funil.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { DateRange } from "@/lib/metrics-period";
import { usePipelines } from "../model/usePipelines";
import { useStagesDoFunil } from "../model/useStagesDoFunil";
import {
  usePipeWhatsappMetrics,
  usePipeConfirmacaoMetrics,
  usePipePropostasMetrics,
  type PipeWhatsappMetrics,
  type PipeConfirmacaoMetrics,
  type PipePropostasMetrics,
} from "./usePipeMetrics";

export interface FunilGenericMetrics {
  /** Cards no recorte (todas as etapas). */
  total: number;
  /** Contagem por stage_key (linhas fantasma com stage_id NULL inclusas pela key). */
  byStageKey: Record<string, number>;
  wonCount: number;
  lostCount: number;
  openCount: number;
  /** won / total * 100 (0 quando total = 0). */
  conversionRate: number;
}

export type FunilMetricsKind = "whatsapp" | "confirmacao" | "propostas" | "generic";

export interface FunilMetrics {
  /** Qual bloco especializado se aplica; "generic" para funil custom. */
  kind: FunilMetricsKind;
  generic: FunilGenericMetrics | null;
  whatsapp: PipeWhatsappMetrics | null;
  confirmacao: PipeConfirmacaoMetrics | null;
  propostas: PipePropostasMetrics | null;
  isLoading: boolean;
}

const SYSTEM_KINDS = new Set(["whatsapp", "confirmacao", "propostas"]);

export function useFunilMetrics(
  pipelineId: string | null | undefined,
  range: DateRange | null,
): FunilMetrics {
  const { organizationId, isReady } = useOrganization();
  const { data: pipelines = [] } = usePipelines();
  const { data: stages = [], isLoading: stagesLoading } = useStagesDoFunil(pipelineId);

  const funil = pipelines.find((p) => p.id === pipelineId);
  const kind: FunilMetricsKind =
    funil?.type === "system" && SYSTEM_KINDS.has(funil.slug)
      ? (funil.slug as FunilMetricsKind)
      : "generic";

  const roleByKey = useMemo(() => {
    const map: Record<string, "won" | "lost" | "other"> = {};
    for (const s of stages) {
      map[s.stage_key] =
        s.stage_role === "won" ? "won" : s.stage_role === "lost" ? "lost" : "other";
    }
    return map;
  }, [stages]);

  const closedKeys = useMemo(
    () => stages.filter((s) => s.stage_role === "won" || s.stage_role === "lost").map((s) => s.stage_key),
    [stages],
  );

  const genericQuery = useQuery({
    queryKey: [
      "funil-generic-metrics",
      pipelineId,
      range?.startStr ?? "all",
      range?.endStr ?? "all",
      closedKeys,
      organizationId,
    ],
    queryFn: async (): Promise<Record<string, number>> => {
      // Ponte de tipo até o regen: get_pipeline_stage_counts_by_id
      // (20270908003000) é mais nova que o types.ts gerado. Sem `any` — nome e
      // args entram como `never` e o shape do retorno é assertado abaixo.
      const { data, error } = await supabase.rpc(
        "get_pipeline_stage_counts_by_id" as unknown as never,
        {
          p_pipeline_id: pipelineId,
          p_org_id: organizationId,
          p_period_after: range?.startStr ?? null,
          p_period_before: range?.endStr ?? null,
          p_closed_status_keys: closedKeys.length ? closedKeys : null,
        } as unknown as never,
      );
      if (error) throw error;
      // Reagrega por stage_key: o motor separa linha fantasma (stage_id NULL)
      // da linha da etapa real — para métrica de cabeçalho a key basta.
      const byKey: Record<string, number> = {};
      for (const row of (data ?? []) as Array<{ stage_key: string; cnt: number | string }>) {
        byKey[row.stage_key] = (byKey[row.stage_key] ?? 0) + Number(row.cnt);
      }
      return byKey;
    },
    enabled: isReady && !!organizationId && !!pipelineId && !stagesLoading,
    staleTime: 60_000,
  });

  const generic = useMemo<FunilGenericMetrics | null>(() => {
    const byStageKey = genericQuery.data;
    if (!byStageKey) return null;
    let total = 0;
    let wonCount = 0;
    let lostCount = 0;
    for (const [key, cnt] of Object.entries(byStageKey)) {
      total += cnt;
      const role = roleByKey[key] ?? "other";
      if (role === "won") wonCount += cnt;
      else if (role === "lost") lostCount += cnt;
    }
    return {
      total,
      byStageKey,
      wonCount,
      lostCount,
      openCount: total - wonCount - lostCount,
      conversionRate: total > 0 ? (wonCount / total) * 100 : 0,
    };
  }, [genericQuery.data, roleByKey]);

  // Blocos legados: chamados incondicionalmente (regra de hooks), ligados só
  // quando o funil resolvido é o slug de sistema correspondente.
  const whatsappQ = usePipeWhatsappMetrics(range, { enabled: kind === "whatsapp" });
  const confirmacaoQ = usePipeConfirmacaoMetrics(range, { enabled: kind === "confirmacao" });
  const propostasQ = usePipePropostasMetrics(range, { enabled: kind === "propostas" });

  const legacyLoading =
    (kind === "whatsapp" && whatsappQ.isLoading) ||
    (kind === "confirmacao" && confirmacaoQ.isLoading) ||
    (kind === "propostas" && propostasQ.isLoading);

  return {
    kind,
    generic,
    whatsapp: kind === "whatsapp" ? whatsappQ.data ?? null : null,
    confirmacao: kind === "confirmacao" ? confirmacaoQ.data ?? null : null,
    propostas: kind === "propostas" ? propostasQ.data ?? null : null,
    isLoading: stagesLoading || genericQuery.isLoading || legacyLoading,
  };
}
