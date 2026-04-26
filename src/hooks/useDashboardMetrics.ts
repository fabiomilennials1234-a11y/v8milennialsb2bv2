import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "./useUserRole";
import { useCurrentTeamMember } from "./useTeamMembers";
import { useRealtimeSubscription } from "./useRealtimeSubscription";
import { isMissingSchemaError } from "@/lib/rpc-errors";

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
  // New fields for Central de Comandos B2B
  propostasEnviadas: number;
  tempoMedioResposta: number;
  vendaPrimeiroPedido: number;
  vendaBaseAtiva: number;
  taxaConversao: number;
  dailySales: Array<{ day: string; revenue: number; count: number }>;
}

const EMPTY_DASHBOARD_METRICS: DashboardMetrics = {
  totalLeads: 0, reunioesMarcadas: 0, reunioesComparecidas: 0,
  noShow: 0, taxaNoShow: 0, vendaTotal: 0, vendaMRR: 0,
  vendaProjeto: 0, ticketMedio: 0, ticketMedioMRR: 0,
  ticketMedioProjeto: 0, novosClientes: 0,
  propostasEnviadas: 0, tempoMedioResposta: 0,
  vendaPrimeiroPedido: 0, vendaBaseAtiva: 0, taxaConversao: 0, dailySales: [],
};

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

  // Realtime: RPC canônica de receita do mês. Invalida quando qualquer pipe
  // muda (venda fechada, reunião compareceu, proposta criada) para que TV
  // Dashboard e aba de comando reflitam em tempo real. Debounce de 2s já
  // tratado em useRealtimeSubscription.
  useRealtimeSubscription("pipe_propostas", ["dashboard-metrics"]);
  useRealtimeSubscription("pipe_confirmacao", ["dashboard-metrics"]);
  useRealtimeSubscription("leads", ["dashboard-metrics"]);

  return useQuery({
    queryKey: ["dashboard-metrics", selectedMonth, selectedYear, effectiveFilter, organizationId],
    queryFn: async (): Promise<DashboardMetrics> => {
      console.log("🔍 [useDashboardMetrics] Chamando RPC:", { organizationId, startStr, endStr, effectiveFilter });

      if (!organizationId) {
        console.warn("⚠️ [useDashboardMetrics] organizationId é null — retornando zeros");
        return {
          totalLeads: 0, reunioesMarcadas: 0, reunioesComparecidas: 0,
          noShow: 0, taxaNoShow: 0, vendaTotal: 0, vendaMRR: 0,
          vendaProjeto: 0, ticketMedio: 0, ticketMedioMRR: 0,
          ticketMedioProjeto: 0, novosClientes: 0,
          propostasEnviadas: 0, tempoMedioResposta: 0,
          vendaPrimeiroPedido: 0, vendaBaseAtiva: 0, taxaConversao: 0, dailySales: [],
        };
      }

      const { data, error } = await supabase.rpc("get_dashboard_metrics", {
        p_org_id: organizationId,
        p_start_date: startStr,
        p_end_date: endStr,
        p_filter_member_id: effectiveFilter,
      });

      if (error) {
        if (isMissingSchemaError(error)) {
          console.warn("⚠️ [useDashboardMetrics] RPC ausente (migration pendente?):", error.message);
          return EMPTY_DASHBOARD_METRICS;
        }
        console.error("❌ [useDashboardMetrics] RPC error:", error.message, error.code, error.details, error.hint);
        throw new Error(`Dashboard metrics failed: ${error.message}`);
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
        propostasEnviadas: d?.propostasEnviadas ?? 0,
        tempoMedioResposta: d?.tempoMedioResposta ?? 0,
        vendaPrimeiroPedido: d?.vendaPrimeiroPedido ?? 0,
        vendaBaseAtiva: d?.vendaBaseAtiva ?? 0,
        taxaConversao: d?.taxaConversao ?? 0,
        dailySales: (d?.dailySales as any[]) ?? [],
      };
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000, // 5 minutos — métricas sobrevivem navegação entre páginas
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
        supabase.from("pipe_confirmacao").select("sdr_id, closer_id, responsible_id, status").eq("organization_id", organizationId).not("metrics_period_at", "is", null).gte("metrics_period_at", startStr).lte("metrics_period_at", endStr),
        supabase.from("pipe_confirmacao").select("sdr_id, closer_id, responsible_id, status").eq("organization_id", organizationId).is("metrics_period_at", null).gte("created_at", startStr).lte("created_at", endStr),
      ]);
      const confirmacaoData = [...(conf1 || []), ...(conf2 || [])];

      // Propostas: TODOS os leads no pipe (sem filtro de período) para taxa de conversão correta
      const { data: propostasData } = await supabase
        .from("pipe_propostas")
        .select("closer_id, responsible_id, status")
        .eq("organization_id", organizationId);

      // Calculate meetings conversion (reuniões marcadas -> comparecidas)
      const meetingsRates: ConversionRate[] = meetingsMembers.map((member) => {
        const total = confirmacaoData?.filter((c) => c.responsible_id === member.id || c.sdr_id === member.id || c.closer_id === member.id).length || 0;
        const comparecidas = confirmacaoData?.filter(
          (c) => (c.responsible_id === member.id || c.sdr_id === member.id || c.closer_id === member.id) && c.status === "compareceu"
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
        const total = (propostasData || []).filter((p) => p.responsible_id === member.id || p.closer_id === member.id).length;
        const vendidas = (propostasData || []).filter(
          (p) => (p.responsible_id === member.id || p.closer_id === member.id) && p.status === "vendido"
        ).length;
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
    staleTime: 5 * 60 * 1000,
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
        if (isMissingSchemaError(error)) {
          console.warn("⚠️ [useFunnelData] RPC ausente (migration pendente?):", error.message);
          return empty;
        }
        console.error("[useFunnelData] RPC error:", error);
        throw new Error(`Funnel data failed: ${error.message}`);
      }

      // Supabase RPC pode retornar JSONB como array — desembrulhar
      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
      const d = raw as Record<string, number> | null;
      return [
        { label: "Leads", value: d?.totalLeads ?? 0, color: "hsl(var(--primary))" },
        { label: "Reuniões Marcadas", value: d?.funnelReunioesMarcadas ?? 0, color: "hsl(var(--chart-2))" },
        { label: "Compareceu", value: d?.funnelCompareceu ?? 0, color: "hsl(var(--chart-3))" },
        { label: "Propostas", value: d?.funnelPropostas ?? 0, color: "hsl(var(--chart-4))" },
        { label: "Vendas", value: d?.funnelVendas ?? 0, color: "hsl(var(--chart-5))" },
      ];
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Ranking do pódio — sempre busca dados frescos (staleTime: 0) para refletir atualizações da RPC. */
export function useRankingData(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;

  // Single subscription — propostas are the primary ranking driver.
  // Goals and confirmacao changes are infrequent and staleTime: 0 handles fresh fetches.
  useRealtimeSubscription("pipe_propostas", ["ranking-data"]);

  return useQuery({
    queryKey: ["ranking-data", selectedMonth, selectedYear, organizationId],
    queryFn: async () => {
      if (!organizationId) return { salesRanking: [], meetingsRanking: [] };

      const { data, error } = await supabase.rpc("get_ranking_data", {
        p_month: selectedMonth,
        p_year: selectedYear,
        p_organization_id: organizationId,
      });

      if (error) {
        if (isMissingSchemaError(error)) {
          console.warn("⚠️ [useRankingData] RPC ausente (migration pendente?):", error.message);
          return { salesRanking: [], meetingsRanking: [] };
        }
        console.error("[useRankingData] RPC error:", error);
        throw new Error(`Ranking data failed: ${error.message}`);
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
    staleTime: 5 * 60 * 1000, // 5 minutos — ranking atualiza via realtime subscription
    refetchOnMount: true,
  });
}
