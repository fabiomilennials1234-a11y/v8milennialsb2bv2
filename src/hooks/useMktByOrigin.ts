import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { useAnalyticsFilters } from "./useAnalyticsFilters";
import { usePipeConfirmacao } from "./usePipeConfirmacao";
import { usePipePropostas } from "./usePipePropostas";
import { useMktOriginConfigs, ALL_ORIGINS, type LeadOrigin } from "./useMktOriginConfig";

export interface OriginMetrics {
  origin: LeadOrigin;
  leadsCount: number;
  agendamentosCount: number;
  comparecimentosCount: number;
  propostasAbertas: number;
  propostasFechadas: number;
  vendasCount: number;
  investimentoReais: number;
  custoPorLead: number;
  custoPorVenda: number;
  conversionRate: number;
  roi: number;
  receitaReais: number;
}

export interface MktSummary {
  totalLeads: number;
  totalInvestimentoReais: number;
  totalCustoPorLead: number;
  totalAgendamentos: number;
  totalComparecimentos: number;
  totalVendas: number;
  totalCustoPorVenda: number;
  totalConversionRate: number;
}

/**
 * Origin-level marketing metrics.
 * Uses useAnalyticsFilters for date filtering (aligned with analytics RPCs).
 * month/year is used ONLY for investment config lookup.
 */
export function useMktByOrigin(month: number, year: number) {
  const { organizationId, isReady } = useOrganization();
  const { filters } = useAnalyticsFilters();

  // Lightweight leads query — no pagination, no joins, minimal fields
  const { data: leads = [], isLoading: loadingLeads } = useQuery({
    queryKey: ["leads-metrics-lite", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("leads")
        .select("id, origin, created_at, metrics_period_at")
        .eq("organization_id", organizationId)
        .or("is_shadow.is.null,is_shadow.eq.false")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: confirmacoes = [], isLoading: loadingConfirmacao } = usePipeConfirmacao();
  const { data: propostas = [], isLoading: loadingPropostas } = usePipePropostas();
  const { configMap, isLoading: loadingConfig } = useMktOriginConfigs(month, year);

  const isLoading = loadingLeads || loadingConfirmacao || loadingPropostas || loadingConfig;

  const { byOrigin, summary } = useMemo(() => {
    const filterStart = filters.startDate;
    const filterEnd = filters.endDate;

    const inRange = (s: string | null | undefined) =>
      s != null && s >= filterStart && s <= filterEnd;

    // Filter leads by analytics period
    const leadsByPeriod = leads.filter(
      (l: { metrics_period_at?: string | null; created_at?: string }) =>
        (l.metrics_period_at != null && inRange(l.metrics_period_at)) ||
        (l.metrics_period_at == null && inRange(l.created_at))
    );

    // Filter confirmacoes by analytics period
    const confirmacoesByPeriod = confirmacoes.filter(
      (c: { metrics_period_at?: string | null; created_at?: string }) =>
        (c.metrics_period_at != null && inRange(c.metrics_period_at)) ||
        (c.metrics_period_at == null && inRange(c.created_at))
    );

    // Group leads by origin
    const leadsByOrigin: Record<string, typeof leadsByPeriod> = {};
    ALL_ORIGINS.forEach((o) => (leadsByOrigin[o] = []));
    leadsByPeriod.forEach((l) => {
      const origin = (l as { origin?: string | null }).origin ?? "outro";
      const bucket = ALL_ORIGINS.includes(origin as LeadOrigin) ? origin : "outro";
      leadsByOrigin[bucket].push(l);
    });

    // Build per-origin metrics
    const byOriginArr: OriginMetrics[] = ALL_ORIGINS.map((origin) => {
      const originLeads = leadsByOrigin[origin] ?? [];
      const leadIdsSet = new Set(originLeads.map((l) => l.id));

      const originConfirmacoes = confirmacoesByPeriod.filter((c) =>
        leadIdsSet.has((c as { lead_id: string }).lead_id)
      );
      const agendamentosCount = originConfirmacoes.length;
      const comparecimentosCount = originConfirmacoes.filter(
        (c) => (c as { status?: string }).status === "compareceu"
      ).length;

      const originPropostas = propostas.filter((p) =>
        leadIdsSet.has((p as { lead_id: string }).lead_id)
      );

      const vendasInPeriod = originPropostas.filter(
        (p: { status?: string; metrics_period_at?: string | null; closed_at?: string | null }) =>
          (p as { status?: string }).status === "vendido" &&
          inRange(
            (p as { metrics_period_at?: string | null }).metrics_period_at ??
            (p as { closed_at?: string | null }).closed_at
          )
      );
      const vendasCount = vendasInPeriod.length;

      const propostasFechadas = originPropostas.filter((p) => {
        const s = (p as { status?: string }).status;
        return s === "vendido" || s === "perdido";
      }).length;
      const propostasAbertas = originPropostas.length - propostasFechadas;

      // Revenue from sales
      const receitaCents = vendasInPeriod.reduce((sum, p) => {
        const items = (p as { items?: Array<{ sale_value?: number | null }> }).items ?? [];
        if (items.length > 0) {
          return sum + items.reduce((s, item) => s + (item.sale_value ?? 0), 0);
        }
        const ticket = (p as { product?: { ticket?: number | null } }).product?.ticket ?? 0;
        return sum + ticket;
      }, 0);
      const receitaReais = receitaCents / 100;

      const config = configMap[origin];
      const investimentoCents = config?.investimento_cents ?? 0;
      const investimentoReais = investimentoCents / 100;

      const leadsCount = originLeads.length;
      const custoPorLead = leadsCount > 0 ? investimentoReais / leadsCount : 0;
      const custoPorVenda = vendasCount > 0 ? investimentoReais / vendasCount : 0;
      const conversionRate = leadsCount > 0 ? (vendasCount / leadsCount) * 100 : 0;
      const roi = investimentoReais > 0 ? ((receitaReais - investimentoReais) / investimentoReais) * 100 : 0;

      return {
        origin,
        leadsCount,
        agendamentosCount,
        comparecimentosCount,
        propostasAbertas,
        propostasFechadas,
        vendasCount,
        investimentoReais,
        custoPorLead,
        custoPorVenda,
        conversionRate,
        roi,
        receitaReais,
      };
    });

    // Summary
    const totalLeads = byOriginArr.reduce((s, o) => s + o.leadsCount, 0);
    const totalInvestimentoReais = byOriginArr.reduce((s, o) => s + o.investimentoReais, 0);
    const totalAgendamentos = byOriginArr.reduce((s, o) => s + o.agendamentosCount, 0);
    const totalComparecimentos = byOriginArr.reduce((s, o) => s + o.comparecimentosCount, 0);
    const totalVendas = byOriginArr.reduce((s, o) => s + o.vendasCount, 0);

    const summaryData: MktSummary = {
      totalLeads,
      totalInvestimentoReais,
      totalCustoPorLead: totalLeads > 0 ? totalInvestimentoReais / totalLeads : 0,
      totalAgendamentos,
      totalComparecimentos,
      totalVendas,
      totalCustoPorVenda: totalVendas > 0 ? totalInvestimentoReais / totalVendas : 0,
      totalConversionRate: totalLeads > 0 ? (totalVendas / totalLeads) * 100 : 0,
    };

    return { byOrigin: byOriginArr, summary: summaryData };
  }, [leads, confirmacoes, propostas, configMap, filters.startDate, filters.endDate]);

  return { byOrigin, summary, configMap, isLoading };
}
