/**
 * useTVKPIs(range)
 *
 * Valores agregados dos KPIs do TV Dashboard para o range do período rotativo.
 * KPI keys batem com src/modules/platform/lib/tv-config-from-quiz.ts.
 *
 * Issue #999 (SP-3, PRD #986, ADR-0017): venda/ticket/conversão vêm do CADERNO
 * canônico get_sales_metrics (#995) — líquido de estorno, agregado no servidor,
 * corte de período no tz da org. Fim do recompute client-side de ticket
 * (Σ sale_value por product_type sobre array truncado em 500) e de conversão.
 * Reunião e no-show seguem em meeting_events (ADR-0007, via useSDRPerformance) —
 * a MESMA fonte usada pelo funil do useTVDashboardData (reconcilia, mata R6).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useSDRPerformance } from "@/modules/engagement/hooks/useSDRPerformance";
import { useCloserPerformance } from "@/modules/engagement/hooks/useCloserPerformance";
import { useNewLeads } from "@/modules/leads";
import { usePipeWhatsapp } from "@/modules/pipelines";
import type { TVPeriodRange } from "@/lib/tv-periods";
import { isMissingSchemaError } from "@/lib/rpc-errors";
import {
  localDateStr,
  unwrapRpcJsonb,
  streamTicket,
  type SalesMetricsResult,
} from "@/modules/analytics/types/canonical-tv";

export type TVKPIKey =
  | "reunioes"
  | "conversao"
  | "noshow"
  | "ticket_mrr"
  | "ticket_proj"
  | "leads"
  | "leads_novos"
  | "propostas"
  | "base_ativa"
  | "respostas";

export interface TVKPIValues {
  reunioes: number; // compareceu count
  conversao: number; // % vendas / (vendas + perdas) — caderno canônico
  noshow: number; // %
  ticket_mrr: number;
  ticket_proj: number;
  leads: number; // leads pra trabalhar (estado, não período)
  leads_novos: number;
  propostas: number;
  base_ativa: number;
  respostas: number;
}

const EMPTY: TVKPIValues = {
  reunioes: 0, conversao: 0, noshow: 0, ticket_mrr: 0, ticket_proj: 0,
  leads: 0, leads_novos: 0, propostas: 0, base_ativa: 0, respostas: 0,
};

export function useTVKPIs(range: TVPeriodRange): TVKPIValues {
  const { organizationId, isReady } = useOrganization();
  const { data: whatsapp = [] } = usePipeWhatsapp();
  const sdrPerf = useSDRPerformance(range);
  const closerPerf = useCloserPerformance(range);
  const newLeads = useNewLeads(range);

  // ── Fonte canônica de VENDA: get_sales_metrics (#995) ────────────────────
  // Período NOMEADO ('range' + datas locais); o banco resolve as fronteiras no
  // tz da org. Frontend NÃO converte tz nem trunca entries.
  const { data: sales } = useQuery({
    queryKey: ["tv-kpi-sales-canonical", organizationId, localDateStr(range.start), localDateStr(range.end)],
    queryFn: async (): Promise<SalesMetricsResult | null> => {
      if (!organizationId) return null;
      const { data, error } = await supabase.rpc("get_sales_metrics" as any, {
        p_org_id: organizationId,
        p_period: "range",
        p_start: localDateStr(range.start),
        p_end: localDateStr(range.end),
        p_pipeline_id: null,
        p_filter_member_id: null, // KPI row é resumo do time inteiro
      });
      if (error) {
        // Ledger vazio / migration pendente → zeros, sem travar a TV (rollback ADR-0018).
        if (isMissingSchemaError(error)) return null;
        throw new Error(`get_sales_metrics failed: ${error.message}`);
      }
      return unwrapRpcJsonb<SalesMetricsResult>(data);
    },
    enabled: isReady && !!organizationId,
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 60,
    refetchIntervalInBackground: false,
  });

  return useMemo(() => {
    if (!organizationId) return EMPTY;

    const wonCount = sales?.won_count ?? 0;
    const lostCount = sales?.lost_count ?? 0;
    const denomConv = wonCount + lostCount;

    // Ticket: derivado dos agregados do servidor (revenue / count por stream),
    // NÃO de re-agregação de entries. TODO(design #999): o caderno modela
    // revenue_stream (novo_negocio|carteira), não product_type (mrr|projeto) —
    // os rótulos "Ticket Médio Rec./Proj." em tv-config-from-quiz devem migrar
    // para "Novo Negócio"/"Carteira". Número já é canônico.
    const ticket_mrr = streamTicket(sales?.revenue_by_stream?.novo_negocio);
    const ticket_proj = streamTicket(sales?.revenue_by_stream?.carteira);

    // Conversão canônica: won / (won + lost). Substitui closerPerf.totals.conversao
    // (recompute client-side sobre pipe truncado).
    const conversao = denomConv > 0 ? (wonCount / denomConv) * 100 : 0;

    // "Leads p/ Trabalhar" = coluna "Novo Lead" (pipe_whatsapp, stage "novo").
    // Estado atual do kanban, não filtra período (fora do escopo de venda #999).
    const leadsAbordado = (whatsapp as any[]).filter((w) => w.status === "abordado").length;
    const leads = (whatsapp as any[]).filter((w) => w.status === "novo").length;

    return {
      // Reunião + no-show: meeting_events (ADR-0007), MESMA fonte do funil (R6 kill).
      reunioes: sdrPerf.totals.comparecidas,
      conversao,
      noshow: sdrPerf.totals.noShowRate,
      ticket_mrr,
      ticket_proj,
      leads,
      leads_novos: newLeads.total,
      // Propostas enviadas: contagem de estado do pipe (não é venda/reunião) — o
      // caderno de venda não expõe "propostas". Segue de closerPerf até SP-4.
      propostas: closerPerf.totals.propostas,
      // Fix #23 (SP-0): base_ativa sem métrica real de carteira — placeholder não
      // exibido (removido do pool). "respostas" conta stage "abordado", rotulado
      // como "Leads Abordados" no TV.
      base_ativa: 0,
      respostas: leadsAbordado,
    };
  }, [
    organizationId,
    sales,
    whatsapp,
    sdrPerf.totals.comparecidas,
    sdrPerf.totals.noShowRate,
    closerPerf.totals.propostas,
    newLeads.total,
    range.start.getTime(),
    range.end.getTime(),
  ]);
}
