import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "./useUserRole";
import { useCurrentTeamMember } from "./useTeamMembers";
import { useRealtimeSubscription } from "./useRealtimeSubscription";

/** Intervalo do mês em UTC — igual ao usado na importação (metrics_period_at = 1º do mês 00:00 UTC). */
function getMonthRangeUTC(month: number, year: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { startStr: start.toISOString(), endStr: end.toISOString() };
}

interface DashboardMetrics {
  totalLeads: number;
  reunioesMarcadas: number;
  reunioesComparecidas: number;
  noShow: number;
  taxaNoShow: number;
  vendaTotal: number;
  vendaMRR: number;
  vendaProjeto: number;
  ticketMedio: number;
  ticketMedioMRR: number;
  ticketMedioProjeto: number;
  novosClientes: number;
}

interface ConversionRate {
  id: string;
  name: string;
  rate: number;
  meetings: number;
  sales: number;
}

/**
 * @param filterMemberId — override the auto-filter logic:
 *   - undefined (default): auto — non-admins filter by their own id, admins get total
 *   - null: force total (no member filter, regardless of role)
 *   - string: filter by that specific team_member_id
 */
export function useDashboardMetrics(month?: number, year?: number, filterMemberId?: string | null) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { isAdmin } = useIsAdmin();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;
  const myId = currentTeamMember?.id ?? null;
  const filterByMe = !isAdmin && myId;

  // Explicit override takes precedence over auto-logic
  const effectiveFilter = filterMemberId !== undefined ? filterMemberId : (filterByMe ? myId : null);

  const { startStr, endStr } = getMonthRangeUTC(selectedMonth, selectedYear);

  return useQuery({
    queryKey: ["dashboard-metrics", selectedMonth, selectedYear, effectiveFilter, organizationId],
    queryFn: async (): Promise<DashboardMetrics> => {
      console.log("🔍 [useDashboardMetrics] Chamando RPC:", { organizationId, startStr, endStr, effectiveFilter });

      if (!organizationId) {
        console.warn("⚠️ [useDashboardMetrics] organizationId é null — retornando zeros");
        return {
          totalLeads: 0,
          reunioesMarcadas: 0,
          reunioesComparecidas: 0,
          noShow: 0,
          taxaNoShow: 0,
          vendaTotal: 0,
          vendaMRR: 0,
          vendaProjeto: 0,
          ticketMedio: 0,
          ticketMedioMRR: 0,
          ticketMedioProjeto: 0,
          novosClientes: 0,
        };
      }

      const { data, error } = await supabase.rpc("get_dashboard_metrics", {
        p_org_id: organizationId,
        p_start_date: startStr,
        p_end_date: endStr,
        p_filter_member_id: effectiveFilter,
      });

      if (error) {
        console.error("❌ [useDashboardMetrics] RPC error:", error.message, error.code, error.details, error.hint);
        return {
          totalLeads: 0, reunioesMarcadas: 0, reunioesComparecidas: 0,
          noShow: 0, taxaNoShow: 0, vendaTotal: 0, vendaMRR: 0,
          vendaProjeto: 0, ticketMedio: 0, ticketMedioMRR: 0,
          ticketMedioProjeto: 0, novosClientes: 0,
        };
      }

      console.log("📊 [useDashboardMetrics] RPC raw response:", data);

      // Supabase RPC pode retornar JSONB como array — desembrulhar
      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
      const d = raw as Record<string, number> | null;
      return {
        totalLeads: d?.totalLeads ?? 0,
        reunioesMarcadas: d?.reunioesMarcadas ?? 0,
        reunioesComparecidas: d?.reunioesComparecidas ?? 0,
        noShow: d?.noShow ?? 0,
        taxaNoShow: d?.taxaNoShow ?? 0,
        vendaTotal: d?.vendaTotal ?? 0,
        vendaMRR: d?.vendaMRR ?? 0,
        vendaProjeto: d?.vendaProjeto ?? 0,
        ticketMedio: d?.ticketMedio ?? 0,
        ticketMedioMRR: d?.ticketMedioMRR ?? 0,
        ticketMedioProjeto: d?.ticketMedioProjeto ?? 0,
        novosClientes: d?.novosClientes ?? 0,
      };
    },
    enabled: !!organizationId,
    staleTime: 60000, // 1 minuto — métricas não mudam a cada segundo
  });
}

export function useConversionRates(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;

  const { startStr, endStr } = getMonthRangeUTC(selectedMonth, selectedYear);

  return useQuery({
    queryKey: ["conversion-rates", selectedMonth, selectedYear, organizationId],
    queryFn: async () => {
      if (!organizationId) return { meetingsRates: [], salesRates: [] };
      const { data: teamMembers } = await supabase
        .from("team_members")
        .select("id, name, role, metric_type")
        .eq("organization_id", organizationId)
        .eq("is_active", true);

      const salesMembers = teamMembers?.filter((m) => m.metric_type === "sales") || [];
      const meetingsMembers = teamMembers?.filter((m) => m.metric_type === "meetings") || [];

      const [{ data: conf1 }, { data: conf2 }] = await Promise.all([
        supabase.from("pipe_confirmacao").select("sdr_id, status").eq("organization_id", organizationId).not("metrics_period_at", "is", null).gte("metrics_period_at", startStr).lte("metrics_period_at", endStr),
        supabase.from("pipe_confirmacao").select("sdr_id, status").eq("organization_id", organizationId).is("metrics_period_at", null).gte("created_at", startStr).lte("created_at", endStr),
      ]);
      const confirmacaoData = [...(conf1 || []), ...(conf2 || [])];

      // Propostas: TODOS os leads no pipe (sem filtro de período) para taxa de conversão correta
      const { data: propostasData } = await supabase
        .from("pipe_propostas")
        .select("closer_id, responsible_id, status")
        .eq("organization_id", organizationId);

      // Calculate meetings conversion (reuniões marcadas -> comparecidas)
      const meetingsRates: ConversionRate[] = meetingsMembers.map((member) => {
        const total = confirmacaoData?.filter((c) => (c.responsible_id || c.sdr_id) === member.id).length || 0;
        const comparecidas = confirmacaoData?.filter(
          (c) => (c.responsible_id || c.sdr_id) === member.id && c.status === "compareceu"
        ).length || 0;
        return {
          id: member.id,
          name: member.name,
          meetings: total,
          sales: comparecidas,
          rate: total > 0 ? (comparecidas / total) * 100 : 0,
        };
      });

      // Calculate sales conversion: TODOS no pipe X vendido
      const salesRates: ConversionRate[] = salesMembers.map((member) => {
        const total = (propostasData || []).filter((p) => (p.responsible_id || p.closer_id) === member.id).length;
        const vendidas = (propostasData || []).filter(
          (p) => (p.responsible_id || p.closer_id) === member.id && p.status === "vendido"
        ).length || 0;
        return {
          id: member.id,
          name: member.name,
          meetings: total,
          sales: vendidas,
          rate: total > 0 ? (vendidas / total) * 100 : 0,
        };
      });

      return { meetingsRates, salesRates };
    },
    enabled: !!organizationId,
  });
}

export function useFunnelData(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;

  const { startStr, endStr } = getMonthRangeUTC(selectedMonth, selectedYear);

  return useQuery({
    queryKey: ["funnel-data", selectedMonth, selectedYear, organizationId],
    queryFn: async () => {
      const empty = [
        { label: "Leads", value: 0, color: "hsl(var(--primary))" },
        { label: "Reuniões Marcadas", value: 0, color: "hsl(var(--chart-2))" },
        { label: "Compareceu", value: 0, color: "hsl(var(--chart-3))" },
        { label: "Propostas", value: 0, color: "hsl(var(--chart-4))" },
        { label: "Vendas", value: 0, color: "hsl(var(--chart-5))" },
      ];
      if (!organizationId) return empty;

      const { data, error } = await supabase.rpc("get_dashboard_metrics", {
        p_org_id: organizationId,
        p_start_date: startStr,
        p_end_date: endStr,
        p_filter_member_id: null,
      });

      if (error) {
        console.error("[useFunnelData] RPC error:", error);
        return empty;
      }

      // Supabase RPC pode retornar JSONB como array — desembrulhar
      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
      const d = raw as Record<string, number> | null;
      return [
        { label: "Leads", value: d?.funnelLeads ?? 0, color: "hsl(var(--primary))" },
        { label: "Reuniões Marcadas", value: d?.funnelReunioes ?? 0, color: "hsl(var(--chart-2))" },
        { label: "Compareceu", value: d?.funnelComparecidas ?? 0, color: "hsl(var(--chart-3))" },
        { label: "Propostas", value: d?.funnelPropostas ?? 0, color: "hsl(var(--chart-4))" },
        { label: "Vendas", value: d?.funnelVendas ?? 0, color: "hsl(var(--chart-5))" },
      ];
    },
    enabled: !!organizationId,
  });
}

/** Ranking do pódio — sempre busca dados frescos (staleTime: 0) para refletir atualizações da RPC. */
export function useRankingData(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;

  useRealtimeSubscription("pipe_propostas", ["ranking-data"]);
  useRealtimeSubscription("pipe_confirmacao", ["ranking-data"]);
  useRealtimeSubscription("goals", ["ranking-data"]);

  return useQuery({
    queryKey: ["ranking-data", selectedMonth, selectedYear, organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_ranking_data", {
        p_month: selectedMonth,
        p_year: selectedYear,
        p_organization_id: organizationId,
      });

      if (error) {
        console.error("[useRankingData] RPC error:", error);
        return { salesRanking: [], meetingsRanking: [] };
      }

      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;

      return {
        salesRanking: (raw?.salesRanking ?? []) as Array<{
          id: string;
          name: string | null;
          job_title: string | null;
          metric_type: string;
          value: number;
          conversions: number;
          goal: number;
          goalProgress: number;
          position: number;
          role: string;
        }>,
        meetingsRanking: (raw?.meetingsRanking ?? []) as Array<{
          id: string;
          name: string | null;
          job_title: string | null;
          metric_type: string;
          value: number;
          meetings: number;
          goal: number;
          goalProgress: number;
          position: number;
          role: string;
        }>,
      };
    },
    enabled: !!organizationId,
    staleTime: 60000, // 1 minuto — ranking não precisa ser real-time, atualiza via realtime subscription
    refetchOnMount: true,
  });
}
