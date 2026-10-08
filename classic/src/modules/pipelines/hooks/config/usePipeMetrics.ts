/**
 * Hooks para métricas dos pipes com suporte a período arbitrário via DateRange.
 * O chamador usa getDateRange() de @/lib/metrics-period para calcular o range;
 * o hook recebe DateRange | null (null = sem filtro = "Geral").
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { DateRange } from "@/lib/metrics-period";

// Re-export para compatibilidade de imports existentes
export type { MetricsPeriod, DateRange, MetricsPeriodState } from "@/lib/metrics-period";

export interface PipePropostasMetrics {
  sold: number;
  soldCount: number;
  mrr: number;
  projeto: number;
  inProgress: number;
  inProgressCount: number;
  conversionRate: number;
}

export interface PipeConfirmacaoMetrics {
  total: number;
  today: number;
  tomorrow: number;
  overdue: number;
  compareceu: number;
  perdido: number;
  remarcar: number;
  noShowRate: number;
  showRate: number;
}

export interface PipeWhatsappMetrics {
  total: number;
  abordado: number;
  respondeu: number;
  scheduled: number;
  pending: number;
}

type SoldRow = {
  sale_value: number | null;
  product_type: string | null;
  contract_duration?: number | null;
  items?: Array<{ sale_value: number | null; product?: { type: string } | null }> | null;
};

function aggregateSoldByItem(rows: SoldRow[]): { sold: number; mrr: number; projeto: number } {
  let sold = 0;
  let mrr = 0;
  let projeto = 0;
  for (const r of rows) {
    const items = r.items?.filter((i) => i != null) ?? [];
    if (items.length > 0) {
      for (const item of items) {
        const val = Number(item.sale_value) || 0;
        const t = item.product?.type;
        sold += val;
        if (t === "mrr") {
          mrr += val;
        } else if (t === "projeto") {
          projeto += val;
        }
      }
    } else {
      const val = Number(r.sale_value) || 0;
      sold += val;
      if (r.product_type === "mrr") {
        mrr += val;
      } else if (r.product_type === "projeto") {
        projeto += val;
      }
    }
  }
  return { sold, mrr, projeto };
}

/**
 * Métricas do pipe de Propostas.
 * range === null → totais históricos ("Geral").
 * range !== null → filtra por intervalo (mês, semana ou custom).
 *
 * `options.enabled` (SCRUM-633): gate real de query — `useFunilMetrics` chama
 * os 3 hooks legados incondicionalmente (regra de hooks) e liga só o do slug
 * resolvido. Mesmo padrão de `useAllFunnelsLeadIds`.
 */
export function usePipePropostasMetrics(
  range: DateRange | null,
  options: { enabled?: boolean } = {},
) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["pipe-propostas-metrics", range?.startStr ?? "all", range?.endStr ?? "all", organizationId],
    queryFn: async (): Promise<PipePropostasMetrics> => {
      if (!organizationId) {
        return { sold: 0, soldCount: 0, mrr: 0, projeto: 0, inProgress: 0, inProgressCount: 0, conversionRate: 0 };
      }

      const activeStatuses = ["marcar_compromisso", "compromisso_marcado", "proposta_enviada", "esfriou", "futuro"];
      const soldSelect = `id, stage_key, sale_value, product_type, contract_duration, items:pipe_proposta_items(sale_value, product:products(type))`;

      if (!range) {
        // "Geral" — sem filtro temporal
        const { data: allData, error: allError } = await supabase
          .from("negocio_projetado")
          .select("stage_key, sale_value, product_type")
          .eq("organization_id", organizationId)
          .eq("funil_sistema", "propostas");
        if (allError) throw allError;

        const { data: soldDataWithItems, error: soldError } = await supabase
          .from("negocio_projetado")
          .select(soldSelect)
          .eq("organization_id", organizationId)
          .eq("funil_sistema", "propostas")
          .eq("stage_key", "vendido");
        if (soldError) throw soldError;

        const inProgressData = (allData || []).filter((r) => activeStatuses.includes(r.stage_key));
        const soldRows = (soldDataWithItems || []) as SoldRow[];
        const { sold, mrr, projeto } = aggregateSoldByItem(soldRows);
        // Taxa de conversão = vendidos / total no pipe (vendidos + perdidos + em progresso).
        // Inclui em progresso para não inflar a taxa quando ninguém marca "perdido".
        const totalNoPipe = (allData || []).length;
        const conversionRate = totalNoPipe > 0 ? (soldRows.length / totalNoPipe) * 100 : 0;

        return {
          sold,
          soldCount: soldRows.length,
          mrr,
          projeto,
          inProgress: inProgressData.reduce((sum, r) => sum + (r.sale_value || 0), 0),
          inProgressCount: inProgressData.length,
          conversionRate,
        };
      }

      // Filtra por range: vendidos no período (COALESCE metrics_period_at, closed_at, updated_at)
      const { startStr, endStr } = range;
      const [propQ1, propQ2, propQ3, activeQ] = await Promise.all([
        supabase
          .from("negocio_projetado")
          .select(soldSelect)
          .eq("organization_id", organizationId)
          .eq("funil_sistema", "propostas")
          .eq("stage_key", "vendido")
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", startStr)
          .lte("metrics_period_at", endStr),
        supabase
          .from("negocio_projetado")
          .select(soldSelect)
          .eq("organization_id", organizationId)
          .eq("funil_sistema", "propostas")
          .eq("stage_key", "vendido")
          .is("metrics_period_at", null)
          .not("closed_at", "is", null)
          .gte("closed_at", startStr)
          .lte("closed_at", endStr),
        supabase
          .from("negocio_projetado")
          .select(soldSelect)
          .eq("organization_id", organizationId)
          .eq("funil_sistema", "propostas")
          .eq("stage_key", "vendido")
          .is("metrics_period_at", null)
          .is("closed_at", null)
          .gte("updated_at", startStr)
          .lte("updated_at", endStr),
        supabase
          .from("negocio_projetado")
          .select("sale_value, stage_key")
          .eq("organization_id", organizationId)
          .eq("funil_sistema", "propostas")
          .in("stage_key", activeStatuses),
      ]);

      const soldData = [...(propQ1.data || []), ...(propQ2.data || []), ...(propQ3.data || [])] as SoldRow[];
      const { sold, mrr, projeto } = aggregateSoldByItem(soldData);

      // Total com atividade no período: entraram no período OU fecharam (vendido/perdido) no período.
      // Denominador correto para evitar taxa inflada quando não marcam "perdido".
      const [enteredQ1, enteredQ2, lostQ1, lostQ2, lostQ3] = await Promise.all([
        supabase
          .from("negocio_projetado")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("funil_sistema", "propostas")
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", startStr)
          .lte("metrics_period_at", endStr),
        supabase
          .from("negocio_projetado")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("funil_sistema", "propostas")
          .is("metrics_period_at", null)
          .gte("created_at", startStr)
          .lte("created_at", endStr),
        supabase
          .from("negocio_projetado")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("funil_sistema", "propostas")
          .eq("stage_key", "perdido")
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", startStr)
          .lte("metrics_period_at", endStr),
        supabase
          .from("negocio_projetado")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("funil_sistema", "propostas")
          .eq("stage_key", "perdido")
          .is("metrics_period_at", null)
          .not("closed_at", "is", null)
          .gte("closed_at", startStr)
          .lte("closed_at", endStr),
        supabase
          .from("negocio_projetado")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("funil_sistema", "propostas")
          .eq("stage_key", "perdido")
          .is("metrics_period_at", null)
          .is("closed_at", null)
          .gte("updated_at", startStr)
          .lte("updated_at", endStr),
      ]);
      const uniqueIds = new Set<string>();
      [enteredQ1.data, enteredQ2.data, lostQ1.data, lostQ2.data, lostQ3.data, propQ1.data, propQ2.data, propQ3.data]
        .forEach(list => list?.forEach((r: { id: string }) => uniqueIds.add(r.id)));
      const totalInPeriod = uniqueIds.size;
      const conversionRate = totalInPeriod > 0 ? (soldData.length / totalInPeriod) * 100 : 0;
      const inProgressData = activeQ.data || [];

      return {
        sold,
        soldCount: soldData.length,
        mrr,
        projeto,
        inProgress: inProgressData.reduce((sum, r) => sum + (r.sale_value || 0), 0),
        inProgressCount: inProgressData.length,
        conversionRate,
      };
    },
    enabled: isReady && !!organizationId && (options.enabled ?? true),
    staleTime: 60000,
  });
}

/**
 * Métricas do pipe de Confirmação.
 * range === null → totais históricos ("Geral").
 * range !== null → filtra por intervalo.
 */
export function usePipeConfirmacaoMetrics(
  range: DateRange | null,
  options: { enabled?: boolean } = {},
) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["pipe-confirmacao-metrics", range?.startStr ?? "all", range?.endStr ?? "all", organizationId],
    queryFn: async (): Promise<PipeConfirmacaoMetrics> => {
      if (!organizationId) {
        return { total: 0, today: 0, tomorrow: 0, overdue: 0, compareceu: 0, perdido: 0, remarcar: 0, noShowRate: 0, showRate: 0 };
      }

      const { data: orgRow } = await supabase
        .from("organizations")
        .select("confirmacao_overdue_days")
        .eq("id", organizationId)
        .single();
      const overdueDays = Math.min(365, Math.max(1, orgRow?.confirmacao_overdue_days ?? 5));
      const overdueLimit = new Date();
      overdueLimit.setDate(overdueLimit.getDate() - overdueDays);

      const isOverdue = (r: { status: string; updated_at?: string | null }) =>
        !["compareceu", "perdido"].includes(r.status) &&
        r.updated_at &&
        new Date(r.updated_at) <= overdueLimit;

      if (!range) {
        // `status:stage_key` — apelido mantém a chave `status` que
        // `computeConfirmacaoStats` e `isOverdue` já consomem.
        const { data, error } = await supabase
          .from("negocio_projetado")
          .select("status:stage_key, meeting_date, updated_at")
          .eq("organization_id", organizationId)
          .eq("funil_sistema", "confirmacao");
        if (error) throw error;
        const list = data || [];
        return computeConfirmacaoStats(list, isOverdue);
      }

      const { startStr, endStr } = range;
      const [conf1, conf2] = await Promise.all([
        supabase
          .from("negocio_projetado")
          .select("status:stage_key, meeting_date, updated_at")
          .eq("organization_id", organizationId)
          .eq("funil_sistema", "confirmacao")
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", startStr)
          .lte("metrics_period_at", endStr),
        supabase
          .from("negocio_projetado")
          .select("status:stage_key, meeting_date, updated_at")
          .eq("organization_id", organizationId)
          .eq("funil_sistema", "confirmacao")
          .is("metrics_period_at", null)
          .gte("created_at", startStr)
          .lte("created_at", endStr),
      ]);

      const list = [...(conf1.data || []), ...(conf2.data || [])];
      return computeConfirmacaoStats(list, isOverdue);
    },
    enabled: isReady && !!organizationId && (options.enabled ?? true),
    staleTime: 60000,
  });
}

export function computeConfirmacaoStats(
  list: Array<{ status: string; meeting_date?: string | null; updated_at?: string | null }>,
  isOverdue: (r: { status: string; updated_at?: string | null }) => boolean,
): PipeConfirmacaoMetrics {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const compareceu = list.filter((r) => r.status === "compareceu").length;
  const perdido = list.filter((r) => r.status === "perdido").length;
  const remarcar = list.filter((r) => r.status === "remarcar").length;

  // No-show triggered by card movement (remarcar/perdido), regardless of
  // meeting_date. Denominator scopes to finalised stages so the rate stays
  // in [0,100].
  const finalizados = list.filter((r) =>
    ["compareceu", "perdido", "remarcar"].includes(r.status),
  );
  const noShowCount = finalizados.filter(
    (r) => r.status === "perdido" || r.status === "remarcar",
  ).length;
  const noShowRate =
    finalizados.length > 0
      ? Math.round((noShowCount / finalizados.length) * 100)
      : 0;
  const showRate =
    finalizados.length > 0
      ? Math.round(
          (finalizados.filter((r) => r.status === "compareceu").length /
            finalizados.length) *
            100,
        )
      : 0;

  return {
    total: list.length,
    today: list.filter((r) => r.meeting_date?.slice(0, 10) === todayStr).length,
    tomorrow: list.filter((r) => r.meeting_date?.slice(0, 10) === tomorrowStr).length,
    overdue: list.filter((r) => isOverdue(r)).length,
    compareceu,
    perdido,
    remarcar,
    noShowRate,
    showRate,
  };
}

/**
 * Métricas do pipe WhatsApp.
 * range === null → totais do pipe ("Geral").
 * range !== null → filtra por created_at no intervalo.
 */
export function usePipeWhatsappMetrics(
  range: DateRange | null,
  options: { enabled?: boolean } = {},
) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["pipe-whatsapp-metrics", range?.startStr ?? "all", range?.endStr ?? "all", organizationId],
    queryFn: async (): Promise<PipeWhatsappMetrics> => {
      if (!organizationId) {
        return { total: 0, abordado: 0, respondeu: 0, scheduled: 0, pending: 0 };
      }

      let query = supabase
        .from("negocio_projetado")
        .select("stage_key")
        .eq("organization_id", organizationId)
        .eq("funil_sistema", "whatsapp");

      if (range) {
        query = query.gte("created_at", range.startStr).lte("created_at", range.endStr);
      }

      const { data, error } = await query;
      if (error) throw error;
      const list = data || [];

      return {
        total: list.length,
        abordado: list.filter((r) => r.stage_key === "abordado").length,
        respondeu: list.filter((r) => r.stage_key === "respondeu").length,
        scheduled: list.filter((r) => r.stage_key === "agendado").length,
        pending: list.filter((r) => r.stage_key === "novo").length,
      };
    },
    enabled: isReady && !!organizationId && (options.enabled ?? true),
    staleTime: 60000,
  });
}
