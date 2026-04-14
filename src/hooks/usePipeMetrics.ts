/**
 * Hooks para métricas dos pipes com suporte a período arbitrário via DateRange.
 * O chamador usa getDateRange() de @/lib/metrics-period para calcular o range;
 * o hook recebe DateRange | null (null = sem filtro = "Geral").
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
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

/**
 * Agrega vendidos por item.
 * Regra de Venda Total:
 *   - Rec.:    mrr += sale_value (mensal);  sold += sale_value * contract_duration
 *   - Projeto: projeto += sale_value;        sold += sale_value
 *   - Unitário:                              sold += sale_value
 * contract_duration nulo/inválido → fallback de 1 mês (evita zerar o contrato).
 */
function aggregateSoldByItem(rows: SoldRow[]): { sold: number; mrr: number; projeto: number } {
  let sold = 0;
  let mrr = 0;
  let projeto = 0;
  for (const r of rows) {
    const duration = Math.max(1, Number(r.contract_duration) || 1);
    const items = r.items?.filter((i) => i != null) ?? [];
    if (items.length > 0) {
      for (const item of items) {
        const val = Number(item.sale_value) || 0;
        const t = item.product?.type;
        if (t === "mrr") {
          mrr += val;
          sold += val * duration;
        } else if (t === "projeto") {
          projeto += val;
          sold += val;
        } else {
          sold += val;
        }
      }
    } else {
      const val = Number(r.sale_value) || 0;
      if (r.product_type === "mrr") {
        mrr += val;
        sold += val * duration;
      } else if (r.product_type === "projeto") {
        projeto += val;
        sold += val;
      } else {
        sold += val;
      }
    }
  }
  return { sold, mrr, projeto };
}

/**
 * Métricas do pipe de Propostas.
 * range === null → totais históricos ("Geral").
 * range !== null → filtra por intervalo (mês, semana ou custom).
 */
export function usePipePropostasMetrics(range: DateRange | null) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["pipe-propostas-metrics", range?.startStr ?? "all", range?.endStr ?? "all", organizationId],
    queryFn: async (): Promise<PipePropostasMetrics> => {
      if (!organizationId) {
        return { sold: 0, soldCount: 0, mrr: 0, projeto: 0, inProgress: 0, inProgressCount: 0, conversionRate: 0 };
      }

      const activeStatuses = ["marcar_compromisso", "compromisso_marcado", "proposta_enviada", "esfriou", "futuro"];
      const soldSelect = `id, status, sale_value, product_type, contract_duration, items:pipe_proposta_items(sale_value, product:products(type))`;

      if (!range) {
        // "Geral" — sem filtro temporal
        const { data: allData, error: allError } = await supabase
          .from("pipe_propostas")
          .select("status, sale_value, product_type")
          .eq("organization_id", organizationId);
        if (allError) throw allError;

        const { data: soldDataWithItems, error: soldError } = await supabase
          .from("pipe_propostas")
          .select(soldSelect)
          .eq("organization_id", organizationId)
          .eq("status", "vendido");
        if (soldError) throw soldError;

        const lostData = (allData || []).filter((r) => r.status === "perdido");
        const inProgressData = (allData || []).filter((r) => activeStatuses.includes(r.status));
        const soldRows = (soldDataWithItems || []) as SoldRow[];
        const { sold, mrr, projeto } = aggregateSoldByItem(soldRows);
        const closedCount = soldRows.length + lostData.length;
        const conversionRate = closedCount > 0 ? (soldRows.length / closedCount) * 100 : 0;

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

      // Filtra por range: vendidos no período (COALESCE metrics_period_at, closed_at), com items
      const { startStr, endStr } = range;
      const [propQ1, propQ2, activeQ] = await Promise.all([
        supabase
          .from("pipe_propostas")
          .select(soldSelect)
          .eq("organization_id", organizationId)
          .eq("status", "vendido")
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", startStr)
          .lte("metrics_period_at", endStr),
        supabase
          .from("pipe_propostas")
          .select(soldSelect)
          .eq("organization_id", organizationId)
          .eq("status", "vendido")
          .is("metrics_period_at", null)
          .gte("closed_at", startStr)
          .lte("closed_at", endStr),
        supabase
          .from("pipe_propostas")
          .select("sale_value, status")
          .eq("organization_id", organizationId)
          .in("status", activeStatuses),
      ]);

      const soldData = [...(propQ1.data || []), ...(propQ2.data || [])] as SoldRow[];
      const { sold, mrr, projeto } = aggregateSoldByItem(soldData);

      const lostQ1 = await supabase
        .from("pipe_propostas")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("status", "perdido")
        .not("metrics_period_at", "is", null)
        .gte("metrics_period_at", startStr)
        .lte("metrics_period_at", endStr);
      const lostQ2 = await supabase
        .from("pipe_propostas")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("status", "perdido")
        .is("metrics_period_at", null)
        .gte("closed_at", startStr)
        .lte("closed_at", endStr);
      const lostCount = (lostQ1.data?.length || 0) + (lostQ2.data?.length || 0);
      const closedCount = soldData.length + lostCount;
      const conversionRate = closedCount > 0 ? (soldData.length / closedCount) * 100 : 0;
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
    enabled: isReady && !!organizationId,
    staleTime: 60000,
  });
}

/**
 * Métricas do pipe de Confirmação.
 * range === null → totais históricos ("Geral").
 * range !== null → filtra por intervalo.
 */
export function usePipeConfirmacaoMetrics(range: DateRange | null) {
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
        const { data, error } = await supabase
          .from("pipe_confirmacao")
          .select("status, meeting_date, updated_at")
          .eq("organization_id", organizationId);
        if (error) throw error;
        const list = data || [];
        return computeConfirmacaoStats(list, isOverdue);
      }

      const { startStr, endStr } = range;
      const [conf1, conf2] = await Promise.all([
        supabase
          .from("pipe_confirmacao")
          .select("status, meeting_date, updated_at")
          .eq("organization_id", organizationId)
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", startStr)
          .lte("metrics_period_at", endStr),
        supabase
          .from("pipe_confirmacao")
          .select("status, meeting_date, updated_at")
          .eq("organization_id", organizationId)
          .is("metrics_period_at", null)
          .gte("created_at", startStr)
          .lte("created_at", endStr),
      ]);

      const list = [...(conf1.data || []), ...(conf2.data || [])];
      return computeConfirmacaoStats(list, isOverdue);
    },
    enabled: isReady && !!organizationId,
    staleTime: 60000,
  });
}

function computeConfirmacaoStats(
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

  const comDataPassada = list.filter(
    (r) => r.meeting_date && new Date(r.meeting_date) <= today,
  );
  const finalizadosDataPassada = comDataPassada.filter((r) =>
    ["compareceu", "perdido", "remarcar"].includes(r.status),
  );
  const noShowCountDataPassada = finalizadosDataPassada.filter(
    (r) => r.status === "perdido" || r.status === "remarcar",
  ).length;
  const noShowRate =
    finalizadosDataPassada.length > 0
      ? Math.round((noShowCountDataPassada / finalizadosDataPassada.length) * 100)
      : 0;
  const showRate =
    finalizadosDataPassada.length > 0
      ? Math.round(
          (finalizadosDataPassada.filter((r) => r.status === "compareceu").length /
            finalizadosDataPassada.length) *
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
export function usePipeWhatsappMetrics(range: DateRange | null) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["pipe-whatsapp-metrics", range?.startStr ?? "all", range?.endStr ?? "all", organizationId],
    queryFn: async (): Promise<PipeWhatsappMetrics> => {
      if (!organizationId) {
        return { total: 0, abordado: 0, respondeu: 0, scheduled: 0, pending: 0 };
      }

      let query = supabase
        .from("pipe_whatsapp")
        .select("status")
        .eq("organization_id", organizationId);

      if (range) {
        query = query.gte("created_at", range.startStr).lte("created_at", range.endStr);
      }

      const { data, error } = await query;
      if (error) throw error;
      const list = data || [];

      return {
        total: list.length,
        abordado: list.filter((r) => r.status === "abordado").length,
        respondeu: list.filter((r) => r.status === "respondeu").length,
        scheduled: list.filter((r) => r.status === "agendado").length,
        pending: list.filter((r) => r.status === "novo").length,
      };
    },
    enabled: isReady && !!organizationId,
    staleTime: 60000,
  });
}
