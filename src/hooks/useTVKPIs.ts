/**
 * useTVKPIs(range)
 *
 * Calcula valores agregados dos KPIs do TV Dashboard para o range do período rotativo.
 * KPI keys batem com src/lib/tv-config-from-quiz.ts.
 */
import { useMemo } from "react";
import { usePipePropostas } from "@/modules/pipelines/hooks/usePipePropostas";
import { usePipeWhatsapp } from "@/modules/pipelines/hooks/usePipeWhatsapp";
import { useSDRPerformance } from "./useSDRPerformance";
import { useCloserPerformance } from "./useCloserPerformance";
import { useNewLeads } from "@/modules/leads";
import { inRange, type TVPeriodRange } from "@/lib/tv-periods";

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
  conversao: number; // % vendas / propostas
  noshow: number; // %
  ticket_mrr: number;
  ticket_proj: number;
  leads: number; // leads pra trabalhar (estado, não período)
  leads_novos: number;
  propostas: number;
  base_ativa: number;
  respostas: number;
}

export function useTVKPIs(range: TVPeriodRange): TVKPIValues {
  const { data: propostas = [] } = usePipePropostas();
  const { data: whatsapp = [] } = usePipeWhatsapp();
  const sdrPerf = useSDRPerformance(range);
  const closerPerf = useCloserPerformance(range);
  const newLeads = useNewLeads(range);

  return useMemo(() => {
    // Ticket médio MRR e Projeto: vendas no range
    const vendasNoRange = (propostas as any[]).filter((p) => {
      if (p.status !== "vendido") return false;
      const at = p.closed_at ?? p.metrics_period_at;
      return inRange(at, range);
    });

    const mrrSales = vendasNoRange.filter((p) => p.product_type === "mrr");
    const projetoSales = vendasNoRange.filter((p) => p.product_type === "projeto");

    const ticket_mrr =
      mrrSales.length > 0
        ? mrrSales.reduce((s, p) => s + (p.sale_value || 0), 0) / mrrSales.length
        : 0;
    const ticket_proj =
      projetoSales.length > 0
        ? projetoSales.reduce((s, p) => s + (p.sale_value || 0), 0) / projetoSales.length
        : 0;

    // Leads pra trabalhar = estado atual (não filtra por período)
    const leadsRemarcar = 0; // sem confirmacoes aqui — derivado de status atual; manter 0 ou recalc
    const leadsNovo = (whatsapp as any[]).filter((w) => w.status === "novo").length;
    const leadsAbordado = (whatsapp as any[]).filter((w) => w.status === "abordado").length;
    const leads = leadsRemarcar + leadsNovo + leadsAbordado;

    return {
      reunioes: sdrPerf.totals.comparecidas,
      conversao: closerPerf.totals.conversao,
      noshow: sdrPerf.totals.noShowRate,
      ticket_mrr,
      ticket_proj,
      leads,
      leads_novos: newLeads.total,
      propostas: closerPerf.totals.propostas,
      base_ativa: 0,
      respostas: leadsAbordado,
    };
  }, [
    propostas,
    whatsapp,
    sdrPerf.totals.comparecidas,
    sdrPerf.totals.noShowRate,
    closerPerf.totals.conversao,
    closerPerf.totals.propostas,
    newLeads.total,
    range.start.getTime(),
    range.end.getTime(),
  ]);
}
