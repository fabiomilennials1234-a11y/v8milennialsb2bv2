import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { useAnalyticsFilters } from "./useAnalyticsFilters";
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

interface RpcOriginRow {
  origin: string;
  leads_count: number;
  agendamentos_count: number;
  comparecimentos_count: number;
  propostas_abertas: number;
  propostas_fechadas: number;
  vendas_count: number;
  receita: number;
}

interface RpcResult {
  origins: RpcOriginRow[];
}

/**
 * Origin-level marketing metrics — SERVER-SIDE via get_mkt_origin_metrics RPC.
 * Replaces the previous client-side aggregation (which fetched all leads/pipes
 * and reduced in the browser, diverging from other analytics RPCs).
 * month/year is used ONLY for investment config lookup (mkt_origin_config table).
 */
export function useMktByOrigin(month: number, year: number) {
  const { organizationId, isReady } = useOrganization();
  const { filters, startStr, endStr } = useAnalyticsFilters();

  const {
    data: rpcData,
    isLoading: loadingRpc,
    isError,
    error,
  } = useQuery({
    queryKey: [
      "mkt-by-origin",
      organizationId,
      startStr,
      endStr,
      filters.memberId,
    ],
    queryFn: async (): Promise<RpcResult> => {
      const { data, error } = await (supabase.rpc as any)(
        "get_mkt_origin_metrics",
        {
          p_org_id: organizationId,
          p_start_date: startStr,
          p_end_date: endStr,
          p_member_id: filters.memberId,
        },
      );

      if (error) {
        console.error("❌ [useMktByOrigin] RPC error:", error.message);
        throw new Error(`Mkt origin metrics failed: ${error.message}`);
      }

      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
      return (raw as RpcResult) ?? { origins: [] };
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  const { configMap, isLoading: loadingConfig } = useMktOriginConfigs(month, year);
  const isLoading = loadingRpc || loadingConfig;

  const { byOrigin, summary } = useMemo(() => {
    const originRows = rpcData?.origins ?? [];

    // Index RPC results by origin for lookup
    const rowByOrigin: Record<string, RpcOriginRow> = {};
    for (const row of originRows) {
      const key = ALL_ORIGINS.includes(row.origin as LeadOrigin) ? row.origin : "outro";
      // If two RPC rows map to "outro" (e.g. unknown origin + null), merge them
      if (rowByOrigin[key]) {
        rowByOrigin[key] = {
          origin: key,
          leads_count: rowByOrigin[key].leads_count + row.leads_count,
          agendamentos_count: rowByOrigin[key].agendamentos_count + row.agendamentos_count,
          comparecimentos_count: rowByOrigin[key].comparecimentos_count + row.comparecimentos_count,
          propostas_abertas: rowByOrigin[key].propostas_abertas + row.propostas_abertas,
          propostas_fechadas: rowByOrigin[key].propostas_fechadas + row.propostas_fechadas,
          vendas_count: rowByOrigin[key].vendas_count + row.vendas_count,
          receita: rowByOrigin[key].receita + row.receita,
        };
      } else {
        rowByOrigin[key] = { ...row, origin: key };
      }
    }

    // Build per-origin metrics for every canonical origin (zero-fill missing)
    const byOriginArr: OriginMetrics[] = ALL_ORIGINS.map((origin) => {
      const row = rowByOrigin[origin];
      const leadsCount = row?.leads_count ?? 0;
      const agendamentosCount = row?.agendamentos_count ?? 0;
      const comparecimentosCount = row?.comparecimentos_count ?? 0;
      const propostasAbertas = row?.propostas_abertas ?? 0;
      const propostasFechadas = row?.propostas_fechadas ?? 0;
      const vendasCount = row?.vendas_count ?? 0;
      // receita comes in reais (sale_value is DECIMAL(12,2) storing reais directly)
      const receitaReais = row?.receita ?? 0;

      const config = configMap[origin];
      // investimento_cents is explicitly in cents (schema + hook pattern)
      const investimentoCents = config?.investimento_cents ?? 0;
      const investimentoReais = investimentoCents / 100;

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
  }, [rpcData, configMap]);

  return { byOrigin, summary, configMap, isLoading, isError, error };
}