/**
 * useCloserPerformance(range)
 *
 * Por closer no range:
 * - reunioesRealizadas: pipe_confirmacao status=compareceu, meeting_date no range, atrib. closer
 * - propostas: pipe_propostas com metrics_period_at ?? created_at no range
 * - vendas: pipe_propostas status=vendido, closed_at no range (ADR 2026-04-24)
 * - vendasValor: Σ sale_value (sem × contract_duration)
 * - ticketMedio: vendasValor / vendas
 * - conversao: vendas / propostas * 100
 *
 * Atribuição closer: sale_responsible_id ?? closer_id (snapshot dual ADR 2026-05-18).
 * Atribuição SDR (pra reunião): closer real = sale_responsible_id ?? closer_id da confirmacao.
 */
import { useMemo } from "react";
import { usePipePropostas } from "@/modules/pipelines/hooks/usePipePropostas";
import { usePipeConfirmacao } from "@/modules/pipelines/hooks/usePipeConfirmacao";
import { useTeamMembers } from "@/modules/identity";
import { useAvatarMap } from "./useAvatarMap";
import { inRange, type TVPeriodRange } from "@/lib/tv-periods";

export interface CloserPerformanceRow {
  id: string;
  name: string;
  avatarUrl?: string;
  reunioesRealizadas: number;
  propostas: number;
  vendas: number;
  vendasValor: number;
  ticketMedio: number;
  conversao: number;
}

export interface CloserPerformanceData {
  totals: {
    reunioesRealizadas: number;
    propostas: number;
    vendas: number;
    vendasValor: number;
    ticketMedio: number;
    conversao: number;
  };
  byCloser: CloserPerformanceRow[];
  topCloserId: string | null;
}

const closerOf = (row: any): string | null =>
  row.sale_responsible_id ?? row.closer_id ?? null;

export function useCloserPerformance(range: TVPeriodRange): CloserPerformanceData {
  const { data: propostas = [] } = usePipePropostas();
  const { data: confirmacoes = [] } = usePipeConfirmacao();
  const { data: teamMembers = [] } = useTeamMembers();
  const avatarMap = useAvatarMap();

  return useMemo(() => {
    const closers = (teamMembers ?? []).filter(
      (m: any) => m.metric_type === "sales" && m.is_active
    );

    const propostasNoRange = (propostas as any[]).filter((p) => {
      const at = p.metrics_period_at ?? p.created_at;
      return inRange(at, range);
    });

    const vendasNoRange = (propostas as any[]).filter((p) => {
      if (p.status !== "vendido") return false;
      const at = p.closed_at ?? p.metrics_period_at;
      return inRange(at, range);
    });

    const reunioesRealizadasNoRange = (confirmacoes as any[]).filter(
      (c) => c.status === "compareceu" && inRange(c.meeting_date, range)
    );

    const byCloser: CloserPerformanceRow[] = closers.map((closer: any) => {
      const cReuns = reunioesRealizadasNoRange.filter((c) => closerOf(c) === closer.id).length;
      const cProps = propostasNoRange.filter((p) => closerOf(p) === closer.id).length;
      const cVendasArr = vendasNoRange.filter((p) => closerOf(p) === closer.id);
      const cVendas = cVendasArr.length;
      const cValor = cVendasArr.reduce((s, p) => s + (p.sale_value || 0), 0);
      const ticket = cVendas > 0 ? cValor / cVendas : 0;
      const conv = cProps > 0 ? (cVendas / cProps) * 100 : 0;

      return {
        id: closer.id,
        name: closer.name,
        avatarUrl: avatarMap.get(closer.id),
        reunioesRealizadas: cReuns,
        propostas: cProps,
        vendas: cVendas,
        vendasValor: cValor,
        ticketMedio: ticket,
        conversao: conv,
      };
    });

    byCloser.sort((a, b) => b.vendasValor - a.vendasValor);

    const totalReuns = reunioesRealizadasNoRange.length;
    const totalProps = propostasNoRange.length;
    const totalVendas = vendasNoRange.length;
    const totalValor = vendasNoRange.reduce((s, p) => s + (p.sale_value || 0), 0);
    const ticketTotal = totalVendas > 0 ? totalValor / totalVendas : 0;
    const convTotal = totalProps > 0 ? (totalVendas / totalProps) * 100 : 0;

    return {
      totals: {
        reunioesRealizadas: totalReuns,
        propostas: totalProps,
        vendas: totalVendas,
        vendasValor: totalValor,
        ticketMedio: ticketTotal,
        conversao: convTotal,
      },
      byCloser,
      topCloserId: byCloser[0]?.id ?? null,
    };
  }, [propostas, confirmacoes, teamMembers, avatarMap, range.start.getTime(), range.end.getTime()]);
}
