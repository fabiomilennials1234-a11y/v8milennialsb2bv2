import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCampanhas } from "./useCampanhas";
import { usePipeConfirmacao } from "./usePipeConfirmacao";
import { usePipePropostas } from "./usePipePropostas";
import { useLeads } from "./useLeads";
import { useOrganization } from "./useOrganization";
import { isOriginCal, isOriginCadastroLp, type MktOriginType } from "@/lib/mktOrigins";

export interface MktFunnelData {
  investimentoReais: number;
  leadsCount: number;
  custoPorLead: number;
  agendamentosCount: number;
  comparecimentosCount: number;
  /** Custo por reunião marcada (inclui no-show). Investimento / agendamentosCount. */
  custoPorAgendamento: number;
  /** Custo por reunião comparecida (exclui no-show). Investimento / comparecimentosCount. */
  custoPorComparecimento: number;
  pctAgendaramVsSóQuiz: string;
  pctCompareceramVsSóAgendaram: string;
  propostasAbertas: number;
  propostasFechadas: number;
  vendasCount: number;
  custoPorVenda: number;
  byFaturamento?: Record<string, number>;
}

function matchOrigin(origin: string | null | undefined, type: MktOriginType): boolean {
  if (type === "cal") return isOriginCal(origin);
  return isOriginCadastroLp(origin);
}

type CampanhaWithLeads = {
  id: string;
  investimento_cents: number | null;
  mkt_investimento_call_cents: number | null;
  mkt_investimento_cadastro_cents: number | null;
  mkt_call_origins: string[] | null;
  mkt_call_tag_ids: string[] | null;
  mkt_cadastro_origins: string[] | null;
  mkt_cadastro_tag_ids: string[] | null;
  mkt_incluir_call: boolean | null;
  mkt_incluir_cadastro: boolean | null;
  mkt_ativo: boolean | null;
  campanha_leads?: Array<{
    lead_id: string;
    lead?: {
      id: string;
      origin?: string | null;
      faturamento?: string | null;
      lead_tags?: Array<{ tag?: { id: string } }>;
    } | null;
  }>;
};

function leadMatchesConfig(
  origin: string | null | undefined,
  tagIds: string[],
  configOrigins: string[] | null,
  configTagIds: string[] | null
): boolean {
  if (!configOrigins?.length && !configTagIds?.length) return false;
  const matchOrigin = configOrigins?.length && origin && configOrigins.includes(origin);
  const matchTag =
    configTagIds?.length && tagIds.some((tid) => configTagIds.includes(tid));
  return !!matchOrigin || !!matchTag;
}

/** Intervalo do mês em UTC (alinhado ao dashboard). */
function getMonthRangeUTC(month: number, year: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { startStr: start.toISOString(), endStr: end.toISOString() };
}

export function useMktFunnel(originType: MktOriginType, month?: number, year?: number) {
  const { organizationId, isReady } = useOrganization();
  const { data: campanhas = [], isLoading: loadingCampanhas } = useCampanhas();
  const { data: confirmacoes = [], isLoading: loadingConfirmacao } = usePipeConfirmacao();
  const { data: propostas = [], isLoading: loadingPropostas } = usePipePropostas();
  const { data: leads = [], isLoading: loadingLeads } = useLeads();

  const { data: campanhasWithLeads = [], isLoading: loadingCampanhasWithLeads } = useQuery({
    queryKey: ["campanhas-mkt-leads", organizationId],
    queryFn: async (): Promise<CampanhaWithLeads[]> => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("campanhas")
        .select(
          "id, investimento_cents, mkt_investimento_call_cents, mkt_investimento_cadastro_cents, mkt_call_origins, mkt_call_tag_ids, mkt_cadastro_origins, mkt_cadastro_tag_ids, mkt_incluir_call, mkt_incluir_cadastro, mkt_ativo, campanha_leads(lead_id, lead:leads(id, origin, faturamento, lead_tags(tag:tags(id))))"
        )
        .eq("organization_id", organizationId)
        .eq("mkt_ativo", true);
      if (error) throw error;
      return (data as CampanhaWithLeads[]) ?? [];
    },
    enabled: isReady && !!organizationId,
  });

  const isLoading =
    loadingCampanhas ||
    loadingConfirmacao ||
    loadingPropostas ||
    loadingLeads ||
    loadingCampanhasWithLeads;

  const data = useMemo((): MktFunnelData | null => {
    const startStr = month != null && year != null ? getMonthRangeUTC(month, year).startStr : null;
    const endStr = month != null && year != null ? getMonthRangeUTC(month, year).endStr : null;

    const inRange = (s: string | null | undefined) =>
      s != null && startStr != null && endStr != null && s >= startStr && s <= endStr;

    const leadsByPeriod =
      startStr != null && endStr != null
        ? leads.filter(
            (l: { metrics_period_at?: string | null; created_at?: string }) =>
              (l.metrics_period_at != null && inRange(l.metrics_period_at)) ||
              (l.metrics_period_at == null && inRange(l.created_at))
          )
        : leads;

    const confirmacoesByPeriod =
      startStr != null && endStr != null
        ? confirmacoes.filter(
            (c: { metrics_period_at?: string | null; created_at?: string }) =>
              (c.metrics_period_at != null && inRange(c.metrics_period_at)) ||
              (c.metrics_period_at == null && inRange(c.created_at))
          )
        : confirmacoes;

    const incluirCall = (c: CampanhaWithLeads) => c.mkt_incluir_call !== false;
    const incluirCadastro = (c: CampanhaWithLeads) => c.mkt_incluir_cadastro !== false;

    const hasCallConfig = campanhasWithLeads.some(
      (c) =>
        incluirCall(c) &&
        ((c.mkt_call_origins?.length ?? 0) > 0 || (c.mkt_call_tag_ids?.length ?? 0) > 0)
    );
    const hasCadastroConfig = campanhasWithLeads.some(
      (c) =>
        incluirCadastro(c) &&
        ((c.mkt_cadastro_origins?.length ?? 0) > 0 || (c.mkt_cadastro_tag_ids?.length ?? 0) > 0)
    );

    const useConfig =
      (originType === "cal" && hasCallConfig) || (originType === "cadastro_lp" && hasCadastroConfig);

    let leadsFiltered: typeof leads;
    let investimentoCents: number;

    if (useConfig && originType === "cal") {
      const callLeadIds = new Set<string>();
      let cents = 0;
      campanhasWithLeads.forEach((c) => {
        if (!incluirCall(c)) return;
        const hasConfig = (c.mkt_call_origins?.length ?? 0) > 0 || (c.mkt_call_tag_ids?.length ?? 0) > 0;
        if (!hasConfig) return;
        cents += c.mkt_investimento_call_cents ?? c.investimento_cents ?? 0;
        (c.campanha_leads ?? []).forEach((cl) => {
          const lead = cl.lead;
          if (!lead) return;
          const origin = lead.origin ?? null;
          const tagIds = (lead.lead_tags ?? [])
            .map((lt) => lt.tag?.id)
            .filter((id): id is string => !!id);
          if (
            leadMatchesConfig(
              origin,
              tagIds,
              c.mkt_call_origins,
              c.mkt_call_tag_ids
            )
          ) {
            callLeadIds.add(lead.id);
          }
        });
      });
      investimentoCents = cents;
      leadsFiltered = leadsByPeriod.filter((l) => callLeadIds.has(l.id));
    } else if (useConfig && originType === "cadastro_lp") {
      const cadastroLeadIds = new Set<string>();
      let cents = 0;
      campanhasWithLeads.forEach((c) => {
        if (!incluirCadastro(c)) return;
        const hasConfig =
          (c.mkt_cadastro_origins?.length ?? 0) > 0 || (c.mkt_cadastro_tag_ids?.length ?? 0) > 0;
        if (!hasConfig) return;
        cents += c.mkt_investimento_cadastro_cents ?? c.investimento_cents ?? 0;
        (c.campanha_leads ?? []).forEach((cl) => {
          const lead = cl.lead;
          if (!lead) return;
          const origin = lead.origin ?? null;
          const tagIds = (lead.lead_tags ?? [])
            .map((lt) => lt.tag?.id)
            .filter((id): id is string => !!id);
          if (
            leadMatchesConfig(
              origin,
              tagIds,
              c.mkt_cadastro_origins,
              c.mkt_cadastro_tag_ids
            )
          ) {
            cadastroLeadIds.add(lead.id);
          }
        });
      });
      investimentoCents = cents;
      leadsFiltered = leadsByPeriod.filter((l) => cadastroLeadIds.has(l.id));
    } else {
      leadsFiltered = leadsByPeriod.filter((l) =>
        matchOrigin((l as { origin?: string }).origin, originType)
      );
      investimentoCents = campanhas.reduce((sum, c) => {
        if (originType === "cal") return sum + (c.mkt_investimento_call_cents ?? c.investimento_cents ?? 0);
        return sum + (c.mkt_investimento_cadastro_cents ?? c.investimento_cents ?? 0);
      }, 0);
    }

    const leadIdsSet = new Set(leadsFiltered.map((l) => l.id));
    const confirmacoesFiltered = confirmacoesByPeriod.filter((c) =>
      leadIdsSet.has((c as { lead_id: string }).lead_id)
    );
    const agendamentosCount = confirmacoesFiltered.length;
    const comparecimentosCount = confirmacoesFiltered.filter(
      (c) => (c as { status?: string }).status === "compareceu"
    ).length;

    const propostasFiltered = propostas.filter((p) =>
      leadIdsSet.has((p as { lead_id: string }).lead_id)
    );
    const vendasInPeriod =
      startStr != null && endStr != null
        ? (p: { status?: string; metrics_period_at?: string | null; closed_at?: string | null }) =>
            (p as { status?: string }).status === "vendido" &&
            inRange((p as { metrics_period_at?: string | null; closed_at?: string }).metrics_period_at ?? (p as { closed_at?: string }).closed_at)
        : (p: { status?: string }) => (p as { status?: string }).status === "vendido";
    const vendasCount = propostasFiltered.filter(vendasInPeriod).length;
    const propostasFechadas = propostasFiltered.filter((p) => {
      const s = (p as { status?: string }).status;
      return s === "vendido" || s === "perdido";
    }).length;
    const propostasAbertas = propostasFiltered.length - propostasFechadas;

    const investimentoReais = investimentoCents / 100;
    const leadsCount = leadsFiltered.length;
    const custoPorLead = leadsCount > 0 ? investimentoReais / leadsCount : 0;
    // Custo por reunião (marcada); inclui no-show
    const custoPorAgendamento = agendamentosCount > 0 ? investimentoReais / agendamentosCount : 0;
    // Custo por reunião comparecida; só quem compareceu
    const custoPorComparecimento =
      comparecimentosCount > 0 ? investimentoReais / comparecimentosCount : 0;
    const custoPorVenda = vendasCount > 0 ? investimentoReais / vendasCount : 0;

    const agendaramCount = confirmacoesFiltered.length;
    const soQuizCount = leadsCount - agendaramCount;
    const pctAgendaram =
      leadsCount > 0 ? ((agendaramCount / leadsCount) * 100).toFixed(1) : "0";
    const pctSoQuiz = leadsCount > 0 ? ((soQuizCount / leadsCount) * 100).toFixed(1) : "0";
    const pctAgendaramVsSóQuiz = `${pctAgendaram}% agendaram / ${pctSoQuiz}% só quiz`;

    const soAgendaramCount = agendamentosCount - comparecimentosCount;
    const pctCompareceram =
      agendamentosCount > 0 ? ((comparecimentosCount / agendamentosCount) * 100).toFixed(1) : "0";
    const pctSoAgendaram =
      agendamentosCount > 0 ? ((soAgendaramCount / agendamentosCount) * 100).toFixed(1) : "0";
    const pctCompareceramVsSóAgendaram = `${pctCompareceram}% compareceram / ${pctSoAgendaram}% só agendaram`;

    const byFaturamento: Record<string, number> = {};
    if (originType === "cal") {
      leadsFiltered.forEach((l) => {
        const f = (l as { faturamento?: string | null }).faturamento ?? "";
        const key = f || "—";
        byFaturamento[key] = (byFaturamento[key] ?? 0) + 1;
      });
    }

    return {
      investimentoReais,
      leadsCount,
      custoPorLead,
      agendamentosCount,
      comparecimentosCount,
      custoPorAgendamento,
      custoPorComparecimento,
      pctAgendaramVsSóQuiz,
      pctCompareceramVsSóAgendaram,
      propostasAbertas,
      propostasFechadas,
      vendasCount,
      custoPorVenda,
      ...(originType === "cal" ? { byFaturamento } : {}),
    };
  }, [
    originType,
    month,
    year,
    campanhas,
    campanhasWithLeads,
    confirmacoes,
    propostas,
    leads,
  ]);

  return { data, isLoading };
}
