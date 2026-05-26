/**
 * useSDRPerformance(range)
 *
 * Agrega métricas de pré-vendas por SDR no range:
 * - marcadas: pipe_confirmacao com metrics_period_at ?? created_at no range
 * - comparecidas: pipe_confirmacao status=compareceu, meeting_date no range
 * - noShow: pipe_confirmacao status in (remarcar, perdido), meeting_date no range
 *
 * Atribuição: pre_sale_responsible_id ?? sdr_id (snapshot dual ADR 2026-05-18).
 */
import { useMemo } from "react";
import { usePipeConfirmacao } from "./usePipeConfirmacao";
import { useTeamMembers } from "@/modules/identity";
import { useAvatarMap } from "./useAvatarMap";
import { inRange, type TVPeriodRange } from "@/lib/tv-periods";

export interface SDRPerformanceRow {
  id: string;
  name: string;
  avatarUrl?: string;
  marcadas: number;
  comparecidas: number;
  noShow: number;
}

export interface SDRPerformanceData {
  totals: {
    marcadas: number;
    comparecidas: number;
    noShow: number;
    noShowRate: number;
  };
  bySDR: SDRPerformanceRow[];
}

export function useSDRPerformance(range: TVPeriodRange): SDRPerformanceData {
  const { data: confirmacoes = [] } = usePipeConfirmacao();
  const { data: teamMembers = [] } = useTeamMembers();
  const avatarMap = useAvatarMap();

  return useMemo(() => {
    const sdrs = (teamMembers ?? []).filter((m: any) => m.metric_type === "meetings" && m.is_active);

    const sdrIdSet = new Set(sdrs.map((s: any) => s.id));

    // Crédito SDR: pre_sale_responsible_id ?? sdr_id
    const sdrOf = (c: any): string | null =>
      c.pre_sale_responsible_id ?? c.sdr_id ?? null;

    const marcadasNoRange = (confirmacoes as any[]).filter((c) => {
      const periodAt = c.metrics_period_at ?? c.created_at;
      return inRange(periodAt, range);
    });

    const eventoNoRange = (confirmacoes as any[]).filter((c) =>
      inRange(c.meeting_date, range)
    );

    const comparecidas = eventoNoRange.filter((c) => c.status === "compareceu");
    const noShows = eventoNoRange.filter(
      (c) => c.status === "remarcar" || c.status === "perdido"
    );

    const bySDR: SDRPerformanceRow[] = sdrs.map((sdr: any) => {
      const marc = marcadasNoRange.filter((c) => sdrOf(c) === sdr.id).length;
      const comp = comparecidas.filter((c) => sdrOf(c) === sdr.id).length;
      const ns = noShows.filter((c) => sdrOf(c) === sdr.id).length;
      return {
        id: sdr.id,
        name: sdr.name,
        avatarUrl: avatarMap.get(sdr.id),
        marcadas: marc,
        comparecidas: comp,
        noShow: ns,
      };
    });

    // Inclui SDRs que aparecem nos dados mas não estão no team_members ativo
    // (snapshot histórico — ex.: SDR desativado mas com cards atribuídos).
    const orphanIds = new Set<string>();
    for (const c of [...marcadasNoRange, ...eventoNoRange]) {
      const id = sdrOf(c);
      if (id && !sdrIdSet.has(id)) orphanIds.add(id);
    }
    for (const oid of orphanIds) {
      const marc = marcadasNoRange.filter((c) => sdrOf(c) === oid).length;
      const comp = comparecidas.filter((c) => sdrOf(c) === oid).length;
      const ns = noShows.filter((c) => sdrOf(c) === oid).length;
      bySDR.push({
        id: oid,
        name: "—",
        avatarUrl: avatarMap.get(oid),
        marcadas: marc,
        comparecidas: comp,
        noShow: ns,
      });
    }

    const totalMarc = marcadasNoRange.length;
    const totalComp = comparecidas.length;
    const totalNs = noShows.length;
    // No-show rate = no-show / (no-show + comparecidas)
    const denom = totalNs + totalComp;
    const noShowRate = denom > 0 ? (totalNs / denom) * 100 : 0;

    bySDR.sort((a, b) => b.marcadas - a.marcadas);

    return {
      totals: {
        marcadas: totalMarc,
        comparecidas: totalComp,
        noShow: totalNs,
        noShowRate,
      },
      bySDR,
    };
  }, [confirmacoes, teamMembers, avatarMap, range.start.getTime(), range.end.getTime()]);
}
