/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo } from "react";
import { humanizeOrigin } from "./analytics-utils";
import {
  AnalyticsPanel,
  AnalyticsStatCard,
  ContinuousFunnel,
  ConversionHealth,
  OriginDonut,
  MemberLeaderboard,
} from "./analytics-ui";

interface PipeConfirmacaoAnalyticsProps {
  items: any[];
  responsibleMembers: { id: string; name: string }[];
}

export function PipeConfirmacaoAnalytics({ items, responsibleMembers }: PipeConfirmacaoAnalyticsProps) {
  // Contagens do funil de comparecimento sobre os itens do período
  const counts = useMemo(() => {
    const total = items.length;
    const confirmadas = items.filter(
      (it) => it.is_confirmed === true || it.status === "compareceu"
    ).length;
    const compareceram = items.filter((it) => it.status === "compareceu").length;
    const showRate = total > 0 ? (compareceram / total) * 100 : 0;
    return { total, confirmadas, compareceram, showRate };
  }, [items]);

  const funnelStages = useMemo(
    () => [
      { key: "marcadas", label: "Reuniões Marcadas", count: counts.total },
      { key: "confirmadas", label: "Confirmadas", count: counts.confirmadas },
      { key: "compareceram", label: "Compareceram", count: counts.compareceram, tone: "success" as const },
    ],
    [counts]
  );

  const conversions = useMemo(
    () => [
      { label: "Confirmação", from: counts.total, to: counts.confirmadas },
      { label: "Comparecimento", from: counts.confirmadas, to: counts.compareceram },
    ],
    [counts]
  );

  // Distribuição por origem
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

  // Performance por responsável — reuniões e comparecimentos
  const leaderboard = useMemo(() => {
    return responsibleMembers
      .map((member) => {
        const memberItems = items.filter(
          (it) =>
            it.responsible_id === member.id ||
            it.sdr_id === member.id ||
            it.closer_id === member.id
        );
        const compareceu = memberItems.filter((it) => it.status === "compareceu").length;
        const rate = memberItems.length > 0 ? (compareceu / memberItems.length) * 100 : 0;
        return {
          id: member.id,
          name: member.name,
          ratePct: rate,
          headline: (
            <>
              {compareceu}{" "}
              <span className="text-xs text-muted-foreground font-medium">
                / {memberItems.length} reuniões
              </span>
            </>
          ),
          subline: `${rate.toFixed(0)}% de comparecimento`,
          total: memberItems.length,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [items, responsibleMembers]);

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <AnalyticsStatCard label="Marcadas" value={counts.total} accent="neutral" />
        <AnalyticsStatCard
          label="Confirmadas"
          value={counts.confirmadas}
          sub={counts.total > 0 ? `${((counts.confirmadas / counts.total) * 100).toFixed(0)}% das marcadas` : undefined}
          accent="blue"
          delay={0.05}
        />
        <AnalyticsStatCard
          label="Compareceram"
          value={counts.compareceram}
          accent="success"
          tintValue
          delay={0.1}
        />
        <AnalyticsStatCard
          label="Show rate"
          value={`${counts.showRate.toFixed(1)}%`}
          sub="compareceram / marcadas"
          accent="gold"
          tintValue
          delay={0.15}
        />
      </div>

      {/* Gráficos */}
      <div className="grid md:grid-cols-2 gap-6">
        <AnalyticsPanel title="Funil de Comparecimento" subtitle="Volume por etapa e perda entre etapas">
          <ContinuousFunnel stages={funnelStages} unit="reuniões" />
        </AnalyticsPanel>

        <AnalyticsPanel title="Taxa de Conversão" subtitle="Saúde de cada passagem" dot="success">
          <ConversionHealth items={conversions} />
        </AnalyticsPanel>

        <AnalyticsPanel title="Reuniões por Origem" subtitle="Distribuição do período" dot="blue">
          <OriginDonut slices={originData} unit="reuniões" />
        </AnalyticsPanel>

        <AnalyticsPanel
          title="Performance por Responsável"
          subtitle="Reuniões trabalhadas e comparecimento"
        >
          <MemberLeaderboard rows={leaderboard} />
        </AnalyticsPanel>
      </div>
    </div>
  );
}
