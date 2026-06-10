/**
 * useSDRPerformance(range)
 *
 * Agrega métricas de pré-vendas por SDR no range — fonte: meeting_events (ADR-0007).
 * - marcadas: eventos meeting_booked com occurred_at no range
 * - comparecidas: eventos meeting_held com (meeting_date ?? occurred_at) no range
 * - noShow: meeting_booked com meeting_date no range já passada e sem meeting_held vinculado
 *
 * Atribuição: pre_sale_responsible_id (snapshot no momento do evento — canônico).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization, useTeamMembers } from "@/modules/identity";
import { useAvatarMap } from "@/modules/identity/hooks/useAvatarMap";
import { inRange, type TVPeriodRange } from "@/lib/tv-periods";
import type { Tables } from "@/integrations/supabase/types";

type MeetingEvent = Tables<"meeting_events">;

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

function useMeetingEvents() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["meeting_events", organizationId],
    queryFn: async (): Promise<MeetingEvent[]> => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("meeting_events")
        .select("*")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: isReady && !!organizationId,
    refetchInterval: 60_000, // TV roda sem realtime nesta tabela
  });
}

export function useSDRPerformance(range: TVPeriodRange): SDRPerformanceData {
  const { data: events = [] } = useMeetingEvents();
  const { data: teamMembers = [] } = useTeamMembers();
  const avatarMap = useAvatarMap();

  return useMemo(() => {
    const sdrs = (teamMembers ?? []).filter((m: any) => m.metric_type === "meetings" && m.is_active);
    const sdrIdSet = new Set(sdrs.map((s: any) => s.id));

    const booked = events.filter((e) => e.event_type === "meeting_booked");
    const held = events.filter((e) => e.event_type === "meeting_held");
    const heldByBookedId = new Set(held.map((h) => h.booked_event_id).filter(Boolean));

    const marcadasNoRange = booked.filter((e) => inRange(e.occurred_at, range));

    const comparecidas = held.filter((e) => inRange(e.meeting_date ?? e.occurred_at, range));

    const now = Date.now();
    const noShows = booked.filter(
      (e) =>
        e.meeting_date &&
        inRange(e.meeting_date, range) &&
        new Date(e.meeting_date).getTime() < now &&
        !heldByBookedId.has(e.id)
    );

    const presaleOf = (e: MeetingEvent): string | null => e.pre_sale_responsible_id ?? null;

    const countFor = (list: MeetingEvent[], id: string) =>
      list.filter((e) => presaleOf(e) === id).length;

    const bySDR: SDRPerformanceRow[] = sdrs.map((sdr: any) => ({
      id: sdr.id,
      name: sdr.name,
      avatarUrl: avatarMap.get(sdr.id),
      marcadas: countFor(marcadasNoRange, sdr.id),
      comparecidas: countFor(comparecidas, sdr.id),
      noShow: countFor(noShows, sdr.id),
    }));

    // Inclui pré-vendas que aparecem nos eventos mas não estão no team_members ativo
    // (snapshot histórico — ex.: membro desativado com reuniões no período).
    const orphanIds = new Set<string>();
    for (const e of [...marcadasNoRange, ...comparecidas, ...noShows]) {
      const id = presaleOf(e);
      if (id && !sdrIdSet.has(id)) orphanIds.add(id);
    }
    for (const oid of orphanIds) {
      bySDR.push({
        id: oid,
        name: "—",
        avatarUrl: avatarMap.get(oid),
        marcadas: countFor(marcadasNoRange, oid),
        comparecidas: countFor(comparecidas, oid),
        noShow: countFor(noShows, oid),
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
  }, [events, teamMembers, avatarMap, range.start.getTime(), range.end.getTime()]);
}
