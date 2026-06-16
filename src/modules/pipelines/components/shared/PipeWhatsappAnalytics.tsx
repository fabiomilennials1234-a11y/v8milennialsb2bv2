/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo } from "react";
import { humanizeOrigin } from "./analytics-utils";
import {
  AnalyticsPanel,
  ContinuousFunnel,
  ConversionHealth,
  OriginDonut,
  MemberLeaderboard,
} from "./analytics-ui";

interface WhatsappStats {
  total: number;
  abordado: number;
  respondeu: number;
  scheduled: number;
  pending: number;
}

interface PipeWhatsappAnalyticsProps {
  items: any[];
  stats: WhatsappStats;
  responsibleMembers: { id: string; name: string }[];
}

export function PipeWhatsappAnalytics({ items, stats, responsibleMembers }: PipeWhatsappAnalyticsProps) {
  // Funil — usa contagens server-side (precisas, sensíveis ao período)
  const funnelStages = useMemo(
    () => [
      { key: "total", label: "Total de Leads", count: stats.total },
      { key: "abordado", label: "Abordados", count: stats.abordado },
      { key: "respondeu", label: "Respondeu", count: stats.respondeu },
      { key: "agendado", label: "Agendados", count: stats.scheduled },
    ],
    [stats]
  );

  // Conversões entre etapas — também das contagens precisas
  const conversions = useMemo(
    () => [
      { label: "Abordagem", from: stats.total, to: stats.abordado },
      { label: "Resposta", from: stats.abordado, to: stats.respondeu },
      { label: "Agendamento", from: stats.respondeu, to: stats.scheduled },
    ],
    [stats]
  );

  // Distribuição por origem (subset carregado)
  const originData = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of items) {
      const key = humanizeOrigin(it.lead?.origin);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [items]);

  // Performance por responsável (subset carregado)
  const leaderboard = useMemo(() => {
    return responsibleMembers
      .map((member) => {
        const memberLeads = items.filter(
          (it) => it.responsible_id === member.id || it.sdr_id === member.id
        );
        const scheduled = memberLeads.filter((it) => it.status === "agendado").length;
        const rate = memberLeads.length > 0 ? (scheduled / memberLeads.length) * 100 : 0;
        return {
          id: member.id,
          name: member.name,
          ratePct: rate,
          headline: (
            <>
              {scheduled}{" "}
              <span className="text-xs text-muted-foreground font-medium">
                / {memberLeads.length} leads
              </span>
            </>
          ),
          subline: `${rate.toFixed(0)}% de agendamento`,
          total: memberLeads.length,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [items, responsibleMembers]);

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <AnalyticsPanel title="Funil de Qualificação" subtitle="Volume por etapa e perda entre etapas">
        <ContinuousFunnel stages={funnelStages} unit="leads" />
      </AnalyticsPanel>

      <AnalyticsPanel title="Taxa de Conversão" subtitle="Saúde de cada passagem do funil" dot="success">
        <ConversionHealth items={conversions} />
      </AnalyticsPanel>

      <AnalyticsPanel title="Leads por Origem" subtitle="Distribuição do período" dot="blue">
        <OriginDonut slices={originData} unit="leads" />
      </AnalyticsPanel>

      <AnalyticsPanel
        title="Performance por Responsável"
        subtitle="Volume trabalhado e conversão em agendamento"
      >
        <MemberLeaderboard rows={leaderboard} />
      </AnalyticsPanel>
    </div>
  );
}
