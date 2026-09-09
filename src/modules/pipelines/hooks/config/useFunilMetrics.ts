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

  /**
   * ── Ganho e perda vêm do NEGÓCIO, não da etapa (B2d) ──────────────────────
   *
   * A versão anterior somava as contagens das etapas cujo `stage_role` era
   * won/lost. Isso deixou de funcionar por dois motivos, e o segundo é fatal:
   *
   * 1. O papel da etapa é inferido do nome e erra — 76 etapas que parecem
   *    perda estão com papel diferente de `lost`, contra 249 corretas.
   * 2. A parte 2 do B2d tira o papel de todas as 375 etapas de desfecho. No
   *    instante em que isso acontece, `closedKeys` fica VAZIO e este bloco
   *    passaria a somar zero — o cabeçalho de todo funil diria "0 vendidos".
   *
   * `get_funil_desfecho_counts` (migration 20270918000030) responde a mesma
   * pergunta ao negócio, e responde certo antes e depois da parte 2. É por
   * isso que ela sobe primeiro.
   */
  const desfechoQuery = useQuery({
    queryKey: [
      "funil-desfecho-counts",
      pipelineId,
      range?.startStr ?? "all",
      range?.endStr ?? "all",
      organizationId,
    ],
    queryFn: async (): Promise<Record<string, number>> => {
      // Ponte de tipo até o regen: a RPC é mais nova que o types.ts gerado.
      const { data, error } = await supabase.rpc(
        "get_funil_desfecho_counts" as unknown as never,
        {
          p_pipeline_id: pipelineId,
          p_org_id: organizationId,
          p_period_after: range?.startStr ?? null,
          p_period_before: range?.endStr ?? null,
        } as unknown as never,
      );
      if (error) throw error;
      const porDesfecho: Record<string, number> = {};
      for (const row of (data ?? []) as Array<{ outcome: string; cnt: number | string }>) {
        porDesfecho[row.outcome] = (porDesfecho[row.outcome] ?? 0) + Number(row.cnt);
      }
      return porDesfecho;
    },
    enabled: isReady && !!organizationId && !!pipelineId,
    staleTime: 60_000,
  });

  const generic = useMemo<FunilGenericMetrics | null>(() => {
    const byStageKey = genericQuery.data;
    if (!byStageKey) return null;
    let total = 0;
    for (const cnt of Object.values(byStageKey)) total += cnt;

    // `total` continua vindo do motor de etapas: ele é o denominador da
    // conversão e carrega os 25 filtros do quadro. O desfecho só decide o
    // NUMERADOR. Misturar as duas fontes num total só faria a conta divergir
    // sempre que um filtro estivesse ativo.
    const porDesfecho = desfechoQuery.data;
    const wonCount = porDesfecho?.won ?? 0;
    const lostCount = porDesfecho?.lost ?? 0;

    return {
      total,
      byStageKey,
      wonCount,
      lostCount,
      openCount: Math.max(0, total - wonCount - lostCount),
      conversionRate: total > 0 ? (wonCount / total) * 100 : 0,
    };
  }, [genericQuery.data, desfechoQuery.data]);

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
