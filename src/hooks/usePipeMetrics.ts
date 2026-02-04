/**
 * Hooks para métricas dos pipes com suporte a período: "Este mês" ou "Geral".
 * Permite visualizar métricas mais precisas por mês ou totais históricos do pipe.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";

/** Intervalo do mês em UTC — igual ao usado na importação (metrics_period_at = 1º do mês 00:00 UTC). */
function getMonthRangeUTC(month: number, year: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { startStr: start.toISOString(), endStr: end.toISOString() };
}

export type MetricsPeriod = "month" | "all";

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

function getMonthRange(month: number, year: number) {
  return getMonthRangeUTC(month, year);
}

/**
 * Métricas do pipe de Propostas: vendido, MRR, projeto, pipeline ativo, taxa de conversão.
 * period "month" = apenas itens cujo período de métrica (ou closed_at) está no mês.
 * period "all" = totais históricos do pipe.
 */
export function usePipePropostasMetrics(
  period: MetricsPeriod,
  month?: number,
  year?: number
) {
  const { organizationId, isReady } = useOrganization();
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { startStr, endStr } = getMonthRange(selectedMonth, selectedYear);

  return useQuery({
    queryKey: ["pipe-propostas-metrics", period, selectedMonth, selectedYear, organizationId],
    queryFn: async (): Promise<PipePropostasMetrics> => {
      if (!organizationId) {
        return {
          sold: 0,
          soldCount: 0,
          mrr: 0,
          projeto: 0,
          inProgress: 0,
          inProgressCount: 0,
          conversionRate: 0,
        };
      }

      const activeStatuses = ["marcar_compromisso", "compromisso_marcado", "esfriou", "futuro"];

      if (period === "all") {
        const { data: allData, error } = await supabase
          .from("pipe_propostas")
          .select("status, sale_value, product_type")
          .eq("organization_id", organizationId);

        if (error) throw error;

        const soldData = (allData || []).filter((r) => r.status === "vendido");
        const lostData = (allData || []).filter((r) => r.status === "perdido");
        const inProgressData = (allData || []).filter((r) => activeStatuses.includes(r.status));

        const sold = soldData.reduce((sum, r) => sum + (r.sale_value || 0), 0);
        const mrr = soldData
          .filter((r) => r.product_type === "mrr")
          .reduce((sum, r) => sum + (r.sale_value || 0), 0);
        const projeto = soldData
          .filter((r) => r.product_type === "projeto")
          .reduce((sum, r) => sum + (r.sale_value || 0), 0);
        const closedCount = soldData.length + lostData.length;
        const conversionRate = closedCount > 0 ? (soldData.length / closedCount) * 100 : 0;

        return {
          sold,
          soldCount: soldData.length,
          mrr,
          projeto,
          inProgress: inProgressData.reduce((sum, r) => sum + (r.sale_value || 0), 0),
          inProgressCount: inProgressData.length,
          conversionRate,
        };
      }

      // period === "month": vendidos no mês (COALESCE metrics_period_at, closed_at)
      const [propQ1, propQ2, activeQ] = await Promise.all([
        supabase
          .from("pipe_propostas")
          .select("sale_value, product_type, status")
          .eq("organization_id", organizationId)
          .eq("status", "vendido")
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", startStr)
          .lte("metrics_period_at", endStr),
        supabase
          .from("pipe_propostas")
          .select("sale_value, product_type, status")
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

      const soldData = [...(propQ1.data || []), ...(propQ2.data || [])];
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

      const sold = soldData.reduce((sum, r) => sum + (r.sale_value || 0), 0);
      const mrr = soldData
        .filter((r) => r.product_type === "mrr")
        .reduce((sum, r) => sum + (r.sale_value || 0), 0);
      const projeto = soldData
        .filter((r) => r.product_type === "projeto")
        .reduce((sum, r) => sum + (r.sale_value || 0), 0);
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
  });
}

/**
 * Métricas do pipe de Confirmação para um período (mês ou geral).
 * Usado para exibir stats filtradas por período na página PipeConfirmacao.
 */
export function usePipeConfirmacaoMetrics(
  period: MetricsPeriod,
  month?: number,
  year?: number
) {
  const { organizationId, isReady } = useOrganization();
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { startStr, endStr } = getMonthRange(selectedMonth, selectedYear);

  return useQuery({
    queryKey: ["pipe-confirmacao-metrics", period, selectedMonth, selectedYear, organizationId],
    queryFn: async (): Promise<PipeConfirmacaoMetrics> => {
      if (!organizationId) {
        return {
          total: 0,
          today: 0,
          tomorrow: 0,
          overdue: 0,
          compareceu: 0,
          perdido: 0,
          remarcar: 0,
          noShowRate: 0,
          showRate: 0,
        };
      }

      if (period === "all") {
        const { data, error } = await supabase
          .from("pipe_confirmacao")
          .select("status, meeting_date")
          .eq("organization_id", organizationId);

        if (error) throw error;
        const list = data || [];
        const today = new Date();
        const todayStr = today.toISOString().slice(0, 10);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().slice(0, 10);

        const compareceu = list.filter((r) => r.status === "compareceu").length;
        const perdido = list.filter((r) => r.status === "perdido").length;
        const remarcar = list.filter((r) => r.status === "remarcar").length;
        const finalizados = compareceu + perdido + remarcar;
        const noShowCount = perdido + remarcar;
        const noShowRate = finalizados > 0 ? Math.round((noShowCount / finalizados) * 100) : 0;
        const showRate = finalizados > 0 ? Math.round((compareceu / finalizados) * 100) : 0;

        return {
          total: list.length,
          today: list.filter((r) => r.meeting_date?.slice(0, 10) === todayStr).length,
          tomorrow: list.filter((r) => r.meeting_date?.slice(0, 10) === tomorrowStr).length,
          overdue: list.filter(
            (r) =>
              r.meeting_date &&
              new Date(r.meeting_date) < today &&
              !["compareceu", "perdido"].includes(r.status)
          ).length,
          compareceu,
          perdido,
          remarcar,
          noShowRate,
          showRate,
        };
      }

      const [conf1, conf2] = await Promise.all([
        supabase
          .from("pipe_confirmacao")
          .select("status, meeting_date")
          .eq("organization_id", organizationId)
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", startStr)
          .lte("metrics_period_at", endStr),
        supabase
          .from("pipe_confirmacao")
          .select("status, meeting_date")
          .eq("organization_id", organizationId)
          .is("metrics_period_at", null)
          .gte("created_at", startStr)
          .lte("created_at", endStr),
      ]);

      const list = [...(conf1.data || []), ...(conf2.data || [])];
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().slice(0, 10);

      const compareceu = list.filter((r) => r.status === "compareceu").length;
      const perdido = list.filter((r) => r.status === "perdido").length;
      const remarcar = list.filter((r) => r.status === "remarcar").length;
      const finalizados = compareceu + perdido + remarcar;
      const noShowCount = perdido + remarcar;
      const noShowRate = finalizados > 0 ? Math.round((noShowCount / finalizados) * 100) : 0;
      const showRate = finalizados > 0 ? Math.round((compareceu / finalizados) * 100) : 0;

      return {
        total: list.length,
        today: list.filter((r) => r.meeting_date?.slice(0, 10) === todayStr).length,
        tomorrow: list.filter((r) => r.meeting_date?.slice(0, 10) === tomorrowStr).length,
        overdue: list.filter(
          (r) =>
            r.meeting_date &&
            new Date(r.meeting_date) < today &&
            !["compareceu", "perdido"].includes(r.status)
        ).length,
        compareceu,
        perdido,
        remarcar,
        noShowRate,
        showRate,
      };
    },
    enabled: isReady && !!organizationId,
  });
}

/**
 * Métricas do pipe WhatsApp: total, abordado, respondeu, agendado.
 * period "month" = itens criados no mês (created_at).
 * period "all" = totais do pipe.
 */
export function usePipeWhatsappMetrics(
  period: MetricsPeriod,
  month?: number,
  year?: number
) {
  const { organizationId, isReady } = useOrganization();
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { startStr, endStr } = getMonthRange(selectedMonth, selectedYear);

  return useQuery({
    queryKey: ["pipe-whatsapp-metrics", period, selectedMonth, selectedYear, organizationId],
    queryFn: async (): Promise<PipeWhatsappMetrics> => {
      if (!organizationId) {
        return { total: 0, abordado: 0, respondeu: 0, scheduled: 0, pending: 0 };
      }

      if (period === "all") {
        const { data, error } = await supabase
          .from("pipe_whatsapp")
          .select("status")
          .eq("organization_id", organizationId);

        if (error) throw error;
        const list = data || [];
        return {
          total: list.length,
          abordado: list.filter((r) => r.status === "abordado").length,
          respondeu: list.filter((r) => r.status === "respondeu").length,
          scheduled: list.filter((r) => r.status === "agendado").length,
          pending: list.filter((r) => r.status === "novo").length,
        };
      }

      const { data, error } = await supabase
        .from("pipe_whatsapp")
        .select("status")
        .eq("organization_id", organizationId)
        .gte("created_at", startStr)
        .lte("created_at", endStr);

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
  });
}
