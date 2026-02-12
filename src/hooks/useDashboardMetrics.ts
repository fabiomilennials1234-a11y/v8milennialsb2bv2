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

export function useDashboardMetrics(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { isAdmin } = useIsAdmin();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;
  const myId = currentTeamMember?.id ?? null;
  const filterByMe = !isAdmin && myId;

  const { startStr, endStr } = getMonthRangeUTC(selectedMonth, selectedYear);

  return useQuery({
    queryKey: ["dashboard-metrics", selectedMonth, selectedYear, filterByMe, myId, organizationId],
    queryFn: async (): Promise<DashboardMetrics> => {
      if (!organizationId) {
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
      // Leads: COALESCE(metrics_period_at, created_at) in range — duas queries
      let leadsQ1 = supabase.from("leads").select("*", { count: "exact", head: true }).eq("organization_id", organizationId).not("metrics_period_at", "is", null).gte("metrics_period_at", startStr).lte("metrics_period_at", endStr);
      let leadsQ2 = supabase.from("leads").select("*", { count: "exact", head: true }).eq("organization_id", organizationId).is("metrics_period_at", null).gte("created_at", startStr).lte("created_at", endStr);
      if (filterByMe) {
        leadsQ1 = leadsQ1.or(`sdr_id.eq.${myId},closer_id.eq.${myId}`);
        leadsQ2 = leadsQ2.or(`sdr_id.eq.${myId},closer_id.eq.${myId}`);
      }
      const [{ count: leadsCount1 }, { count: leadsCount2 }] = await Promise.all([leadsQ1, leadsQ2]);
      const totalLeads = (leadsCount1 || 0) + (leadsCount2 || 0);

      // pipe_confirmacao: COALESCE(metrics_period_at, created_at) in range
      let confQ1 = supabase.from("pipe_confirmacao").select("status, meeting_date, sdr_id, closer_id").eq("organization_id", organizationId).not("metrics_period_at", "is", null).gte("metrics_period_at", startStr).lte("metrics_period_at", endStr);
      let confQ2 = supabase.from("pipe_confirmacao").select("status, meeting_date, sdr_id, closer_id").eq("organization_id", organizationId).is("metrics_period_at", null).gte("created_at", startStr).lte("created_at", endStr);
      if (filterByMe) {
        confQ1 = confQ1.or(`sdr_id.eq.${myId},closer_id.eq.${myId}`);
        confQ2 = confQ2.or(`sdr_id.eq.${myId},closer_id.eq.${myId}`);
      }
      const [{ data: confData1 }, { data: confData2 }] = await Promise.all([confQ1, confQ2]);
      const confirmacaoData = [...(confData1 || []), ...(confData2 || [])];

      const reunioesMarcadas = confirmacaoData.length;
      const reunioesComparecidas = confirmacaoData.filter((c) => c.status === "compareceu").length;

      // Taxa de no-show: apenas reuniões cuja data já passou e já têm desfecho (não inclui agendadas futuras)
      const now = new Date();
      const comDataPassada = confirmacaoData.filter(
        (c) => c.meeting_date && new Date(c.meeting_date) <= now
      );
      const finalizadosDataPassada = comDataPassada.filter((c) =>
        ["compareceu", "perdido", "remarcar"].includes(c.status)
      );
      const noShow = finalizadosDataPassada.filter(
        (c) => c.status === "perdido" || c.status === "remarcar"
      ).length;
      const taxaNoShow =
        finalizadosDataPassada.length > 0
          ? Math.round((noShow / finalizadosDataPassada.length) * 100)
          : 0;

      // pipe_propostas vendido: COALESCE(metrics_period_at, closed_at) in range; agregação por item (MRR/Projeto por product.type; unitário só no total)
      const propSelect = "sale_value, product_type, items:pipe_proposta_items(sale_value, product:products(type))";
      let propQ1 = supabase.from("pipe_propostas").select(propSelect).eq("organization_id", organizationId).eq("status", "vendido").not("metrics_period_at", "is", null).gte("metrics_period_at", startStr).lte("metrics_period_at", endStr);
      let propQ2 = supabase.from("pipe_propostas").select(propSelect).eq("organization_id", organizationId).eq("status", "vendido").is("metrics_period_at", null).gte("closed_at", startStr).lte("closed_at", endStr);
      if (filterByMe) {
        propQ1 = propQ1.eq("closer_id", myId);
        propQ2 = propQ2.eq("closer_id", myId);
      }
      const [{ data: propData1 }, { data: propData2 }] = await Promise.all([propQ1, propQ2]);
      const vendasFechadas = [...(propData1 || []), ...(propData2 || [])] as Array<{ sale_value: number | null; product_type: string | null; items?: Array<{ sale_value: number | null; product?: { type: string } | null }> | null }>;

      let vendaTotal = 0;
      let vendaMRR = 0;
      let vendaProjeto = 0;
      let mrrProposalCount = 0;
      let projetoProposalCount = 0;
      for (const v of vendasFechadas) {
        const items = v.items?.filter((i) => i != null) ?? [];
        if (items.length > 0) {
          let propTotal = 0;
          let propMrr = 0;
          let propProj = 0;
          for (const it of items) {
            const val = Number(it.sale_value) || 0;
            propTotal += val;
            const t = it.product?.type;
            if (t === "mrr") propMrr += val;
            else if (t === "projeto") propProj += val;
          }
          vendaTotal += propTotal;
          vendaMRR += propMrr;
          vendaProjeto += propProj;
          if (propMrr > 0) mrrProposalCount += 1;
          if (propProj > 0) projetoProposalCount += 1;
        } else {
          const val = Number(v.sale_value) || 0;
          vendaTotal += val;
          if (v.product_type === "mrr") {
            vendaMRR += val;
            mrrProposalCount += 1;
          } else if (v.product_type === "projeto") {
            vendaProjeto += val;
            projetoProposalCount += 1;
          }
        }
      }

      const novosClientes = vendasFechadas.length;
      const ticketMedio = novosClientes > 0 ? vendaTotal / novosClientes : 0;
      const ticketMedioMRR = mrrProposalCount > 0 ? vendaMRR / mrrProposalCount : 0;
      const ticketMedioProjeto = projetoProposalCount > 0 ? vendaProjeto / projetoProposalCount : 0;

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
    enabled: !!organizationId,
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
      if (!organizationId) return { sdrRates: [], closerRates: [] };
      const { data: teamMembers } = await supabase
        .from("team_members")
        .select("id, name, role")
        .eq("organization_id", organizationId)
        .eq("is_active", true);

      const closers = teamMembers?.filter((m) => m.role === "closer") || [];
      const sdrs = teamMembers?.filter((m) => m.role === "sdr") || [];

      const [{ data: conf1 }, { data: conf2 }] = await Promise.all([
        supabase.from("pipe_confirmacao").select("sdr_id, status").eq("organization_id", organizationId).not("metrics_period_at", "is", null).gte("metrics_period_at", startStr).lte("metrics_period_at", endStr),
        supabase.from("pipe_confirmacao").select("sdr_id, status").eq("organization_id", organizationId).is("metrics_period_at", null).gte("created_at", startStr).lte("created_at", endStr),
      ]);
      const confirmacaoData = [...(conf1 || []), ...(conf2 || [])];

      // Propostas: TODOS os leads no pipe (sem filtro de período) para taxa de conversão correta
      const { data: propostasData } = await supabase
        .from("pipe_propostas")
        .select("closer_id, status")
        .eq("organization_id", organizationId);

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

      // Calculate Closer conversion: TODOS no pipe X vendido
      const closerRates: ConversionRate[] = closers.map((closer) => {
        const total = (propostasData || []).filter((p) => p.closer_id === closer.id).length;
        const vendidas = (propostasData || []).filter(
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
      if (!organizationId) {
        return [
          { label: "Leads", value: 0, color: "hsl(var(--primary))" },
          { label: "Reuniões Marcadas", value: 0, color: "hsl(var(--chart-2))" },
          { label: "Compareceu", value: 0, color: "hsl(var(--chart-3))" },
          { label: "Propostas", value: 0, color: "hsl(var(--chart-4))" },
          { label: "Vendas", value: 0, color: "hsl(var(--chart-5))" },
        ];
      }
      const [
        { count: leadsC1 },
        { count: leadsC2 },
        { count: reunC1 },
        { count: reunC2 },
        { count: compC1 },
        { count: compC2 },
        { count: propC1 },
        { count: propC2 },
        { count: vendC1 },
        { count: vendC2 },
      ] = await Promise.all([
        supabase.from("leads").select("*", { count: "exact", head: true }).eq("organization_id", organizationId).not("metrics_period_at", "is", null).gte("metrics_period_at", startStr).lte("metrics_period_at", endStr),
        supabase.from("leads").select("*", { count: "exact", head: true }).eq("organization_id", organizationId).is("metrics_period_at", null).gte("created_at", startStr).lte("created_at", endStr),
        supabase.from("pipe_confirmacao").select("*", { count: "exact", head: true }).eq("organization_id", organizationId).not("metrics_period_at", "is", null).gte("metrics_period_at", startStr).lte("metrics_period_at", endStr),
        supabase.from("pipe_confirmacao").select("*", { count: "exact", head: true }).eq("organization_id", organizationId).is("metrics_period_at", null).gte("created_at", startStr).lte("created_at", endStr),
        supabase.from("pipe_confirmacao").select("*", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "compareceu").not("metrics_period_at", "is", null).gte("metrics_period_at", startStr).lte("metrics_period_at", endStr),
        supabase.from("pipe_confirmacao").select("*", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "compareceu").is("metrics_period_at", null).gte("created_at", startStr).lte("created_at", endStr),
        supabase.from("pipe_propostas").select("*", { count: "exact", head: true }).eq("organization_id", organizationId).not("metrics_period_at", "is", null).gte("metrics_period_at", startStr).lte("metrics_period_at", endStr),
        supabase.from("pipe_propostas").select("*", { count: "exact", head: true }).eq("organization_id", organizationId).is("metrics_period_at", null).gte("created_at", startStr).lte("created_at", endStr),
        supabase.from("pipe_propostas").select("*", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "vendido").not("metrics_period_at", "is", null).gte("metrics_period_at", startStr).lte("metrics_period_at", endStr),
        supabase.from("pipe_propostas").select("*", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "vendido").is("metrics_period_at", null).gte("closed_at", startStr).lte("closed_at", endStr),
      ]);
      const totalLeads = (leadsC1 || 0) + (leadsC2 || 0);
      const reunioesMarcadas = (reunC1 || 0) + (reunC2 || 0);
      const reunioesComparecidas = (compC1 || 0) + (compC2 || 0);
      const propostas = (propC1 || 0) + (propC2 || 0);
      const vendas = (vendC1 || 0) + (vendC2 || 0);

      return [
        { label: "Leads", value: totalLeads || 0, color: "hsl(var(--primary))" },
        { label: "Reuniões Marcadas", value: reunioesMarcadas || 0, color: "hsl(var(--chart-2))" },
        { label: "Compareceu", value: reunioesComparecidas || 0, color: "hsl(var(--chart-3))" },
        { label: "Propostas", value: propostas || 0, color: "hsl(var(--chart-4))" },
        { label: "Vendas", value: vendas || 0, color: "hsl(var(--chart-5))" },
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
      });

      if (error) {
        console.error("[useRankingData] RPC error:", error);
        return { closerRanking: [], sdrRanking: [] };
      }

      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;

      return {
        closerRanking: (raw?.closerRanking ?? []) as Array<{
          id: string;
          name: string | null;
          value: number;
          conversions: number;
          goal: number;
          goalProgress: number;
          position: number;
          role: "Closer";
        }>,
        sdrRanking: (raw?.sdrRanking ?? []) as Array<{
          id: string;
          name: string | null;
          value: number;
          meetings: number;
          goal: number;
          goalProgress: number;
          position: number;
          role: "SDR";
        }>,
      };
    },
    enabled: !!organizationId,
    staleTime: 0,
    refetchOnMount: "always",
  });
}
