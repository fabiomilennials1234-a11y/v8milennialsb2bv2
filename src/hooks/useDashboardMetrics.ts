import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { startOfMonth, endOfMonth } from "date-fns";
import { useIsAdmin } from "./useUserRole";
import { useCurrentTeamMember } from "./useTeamMembers";

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

export function useDashboardMetrics(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { isAdmin } = useIsAdmin();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const myId = currentTeamMember?.id ?? null;
  const filterByMe = !isAdmin && myId;

  const startDate = startOfMonth(new Date(selectedYear, selectedMonth - 1));
  const endDate = endOfMonth(new Date(selectedYear, selectedMonth - 1));

  return useQuery({
    queryKey: ["dashboard-metrics", selectedMonth, selectedYear, filterByMe, myId],
    queryFn: async (): Promise<DashboardMetrics> => {
      // Total Leads: quando dashboard "só meu", filtrar por sdr_id ou closer_id = myId
      let leadsQuery = supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString());
      if (filterByMe) {
        leadsQuery = leadsQuery.or(`sdr_id.eq.${myId},closer_id.eq.${myId}`);
      }
      const { count: totalLeads } = await leadsQuery;

      // Pipe Confirmação: quando filterByMe, só onde sdr_id ou closer_id = myId
      let confirmacaoQuery = supabase
        .from("pipe_confirmacao")
        .select("status, meeting_date, sdr_id, closer_id")
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString());
      if (filterByMe) {
        confirmacaoQuery = confirmacaoQuery.or(`sdr_id.eq.${myId},closer_id.eq.${myId}`);
      }
      const { data: confirmacaoData } = await confirmacaoQuery;

      const reunioesMarcadas = confirmacaoData?.length || 0;
      const reunioesComparecidas = confirmacaoData?.filter(
        (c) => c.status === "compareceu"
      ).length || 0;
      const noShow = confirmacaoData?.filter(
        (c) => c.status === "perdido"
      ).length || 0;
      const taxaNoShow = reunioesMarcadas > 0 ? (noShow / reunioesMarcadas) * 100 : 0;

      // Pipe Propostas - vendas fechadas: quando filterByMe, só closer_id = myId
      let propostasQuery = supabase
        .from("pipe_propostas")
        .select("sale_value, product_type, status, closed_at")
        .eq("status", "vendido")
        .gte("closed_at", startDate.toISOString())
        .lte("closed_at", endDate.toISOString());
      if (filterByMe) {
        propostasQuery = propostasQuery.eq("closer_id", myId);
      }
      const { data: propostasData } = await propostasQuery;

      const vendasFechadas = propostasData || [];
      const vendaTotal = vendasFechadas.reduce((sum, v) => sum + (v.sale_value || 0), 0);
      const vendaMRR = vendasFechadas
        .filter((v) => v.product_type === "mrr")
        .reduce((sum, v) => sum + (v.sale_value || 0), 0);
      const vendaProjeto = vendasFechadas
        .filter((v) => v.product_type === "projeto")
        .reduce((sum, v) => sum + (v.sale_value || 0), 0);

      const novosClientes = vendasFechadas.length;
      const ticketMedio = novosClientes > 0 ? vendaTotal / novosClientes : 0;
      
      const mrrSales = vendasFechadas.filter((v) => v.product_type === "mrr");
      const projetoSales = vendasFechadas.filter((v) => v.product_type === "projeto");
      const ticketMedioMRR = mrrSales.length > 0 ? vendaMRR / mrrSales.length : 0;
      const ticketMedioProjeto = projetoSales.length > 0 ? vendaProjeto / projetoSales.length : 0;

      return {
        totalLeads: totalLeads || 0,
        reunioesMarcadas,
        reunioesComparecidas,
        noShow,
        taxaNoShow,
        vendaTotal,
        vendaMRR,
        vendaProjeto,
        ticketMedio,
        ticketMedioMRR,
        ticketMedioProjeto,
        novosClientes,
      };
    },
  });
}

export function useConversionRates(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  
  const startDate = startOfMonth(new Date(selectedYear, selectedMonth - 1));
  const endDate = endOfMonth(new Date(selectedYear, selectedMonth - 1));

  return useQuery({
    queryKey: ["conversion-rates", selectedMonth, selectedYear],
    queryFn: async () => {
      // Get team members
      const { data: teamMembers } = await supabase
        .from("team_members")
        .select("id, name, role")
        .eq("is_active", true);

      const closers = teamMembers?.filter((m) => m.role === "closer") || [];
      const sdrs = teamMembers?.filter((m) => m.role === "sdr") || [];

      // Get confirmacao data for SDR conversion (meetings comparecidas)
      const { data: confirmacaoData } = await supabase
        .from("pipe_confirmacao")
        .select("sdr_id, status")
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString());

      // Get propostas data for Closer conversion
      const { data: propostasData } = await supabase
        .from("pipe_propostas")
        .select("closer_id, status")
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString());

      // Calculate SDR conversion (reuniões marcadas -> comparecidas)
      const sdrRates: ConversionRate[] = sdrs.map((sdr) => {
        const total = confirmacaoData?.filter((c) => c.sdr_id === sdr.id).length || 0;
        const comparecidas = confirmacaoData?.filter(
          (c) => c.sdr_id === sdr.id && c.status === "compareceu"
        ).length || 0;
        return {
          id: sdr.id,
          name: sdr.name,
          meetings: total,
          sales: comparecidas,
          rate: total > 0 ? (comparecidas / total) * 100 : 0,
        };
      });

      // Calculate Closer conversion (propostas -> vendidas)
      const closerRates: ConversionRate[] = closers.map((closer) => {
        const total = propostasData?.filter((p) => p.closer_id === closer.id).length || 0;
        const vendidas = propostasData?.filter(
          (p) => p.closer_id === closer.id && p.status === "vendido"
        ).length || 0;
        return {
          id: closer.id,
          name: closer.name,
          meetings: total,
          sales: vendidas,
          rate: total > 0 ? (vendidas / total) * 100 : 0,
        };
      });

      return { sdrRates, closerRates };
    },
  });
}

export function useFunnelData(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  
  const startDate = startOfMonth(new Date(selectedYear, selectedMonth - 1));
  const endDate = endOfMonth(new Date(selectedYear, selectedMonth - 1));

  return useQuery({
    queryKey: ["funnel-data", selectedMonth, selectedYear],
    queryFn: async () => {
      // Leads
      const { count: totalLeads } = await supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString());

      // Reuniões marcadas (pipe_confirmacao)
      const { count: reunioesMarcadas } = await supabase
        .from("pipe_confirmacao")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString());

      // Reuniões comparecidas
      const { count: reunioesComparecidas } = await supabase
        .from("pipe_confirmacao")
        .select("*", { count: "exact", head: true })
        .eq("status", "compareceu")
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString());

      // Propostas
      const { count: propostas } = await supabase
        .from("pipe_propostas")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString());

      // Vendas fechadas
      const { count: vendas } = await supabase
        .from("pipe_propostas")
        .select("*", { count: "exact", head: true })
        .eq("status", "vendido")
        .gte("closed_at", startDate.toISOString())
        .lte("closed_at", endDate.toISOString());

      return [
        { label: "Leads", value: totalLeads || 0, color: "hsl(var(--primary))" },
        { label: "Reuniões Marcadas", value: reunioesMarcadas || 0, color: "hsl(var(--chart-2))" },
        { label: "Compareceu", value: reunioesComparecidas || 0, color: "hsl(var(--chart-3))" },
        { label: "Propostas", value: propostas || 0, color: "hsl(var(--chart-4))" },
        { label: "Vendas", value: vendas || 0, color: "hsl(var(--chart-5))" },
      ];
    },
  });
}

export function useRankingData(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  
  const startDate = startOfMonth(new Date(selectedYear, selectedMonth - 1));
  const endDate = endOfMonth(new Date(selectedYear, selectedMonth - 1));

  return useQuery({
    queryKey: ["ranking-data", selectedMonth, selectedYear],
    queryFn: async () => {
      // Get team members
      const { data: teamMembers } = await supabase
        .from("team_members")
        .select("id, name, role")
        .eq("is_active", true);

      const closers = teamMembers?.filter((m) => m.role === "closer") || [];
      const sdrs = teamMembers?.filter((m) => m.role === "sdr") || [];

      // Get all closed sales
      const { data: sales } = await supabase
        .from("pipe_propostas")
        .select("closer_id, sale_value, status")
        .eq("status", "vendido")
        .gte("closed_at", startDate.toISOString())
        .lte("closed_at", endDate.toISOString());

      // Get all compareceu meetings
      const { data: meetings } = await supabase
        .from("pipe_confirmacao")
        .select("sdr_id, status")
        .eq("status", "compareceu")
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString());

      // Get goals
      const { data: goals } = await supabase
        .from("goals")
        .select("team_member_id, target_value, current_value, type")
        .eq("month", selectedMonth)
        .eq("year", selectedYear);

      // Calculate closer rankings
      const closerRanking = closers
        .map((closer) => {
          const closerSales = sales?.filter((s) => s.closer_id === closer.id) || [];
          const totalValue = closerSales.reduce((sum, s) => sum + (s.sale_value || 0), 0);
          const goal = goals?.find((g) => g.team_member_id === closer.id && g.type === "vendas");
          const goalProgress = goal?.target_value 
            ? (totalValue / goal.target_value) * 100 
            : 0;
          
          return {
            id: closer.id,
            name: closer.name,
            value: totalValue,
            conversions: closerSales.length,
            goalProgress: Math.round(goalProgress),
          };
        })
        .sort((a, b) => b.value - a.value)
        .map((item, index) => ({ ...item, position: index + 1, role: "Closer" as const }));

      // Calculate SDR rankings (by meetings comparecidas)
      const sdrRanking = sdrs
        .map((sdr) => {
          const sdrMeetings = meetings?.filter((m) => m.sdr_id === sdr.id) || [];
          const goal = goals?.find((g) => g.team_member_id === sdr.id && g.type === "reunioes");
          const goalProgress = goal?.target_value 
            ? (sdrMeetings.length / goal.target_value) * 100 
            : 0;
          
          return {
            id: sdr.id,
            name: sdr.name,
            value: 0,
            meetings: sdrMeetings.length,
            goalProgress: Math.round(goalProgress),
          };
        })
        .sort((a, b) => (b.meetings || 0) - (a.meetings || 0))
        .map((item, index) => ({ ...item, position: index + 1, role: "SDR" as const }));

      return { closerRanking, sdrRanking };
    },
  });
}
