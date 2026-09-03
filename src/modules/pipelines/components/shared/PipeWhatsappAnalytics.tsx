/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo } from "react";
import { humanizeOrigin } from "./analytics-utils";
import {
  AnalyticsPanel,
  AnalyticsStatCard,
  ContinuousFunnel,
  ConversionHealth,
  OriginDonut,
} from "./analytics-ui";
import { MeetingPerformancePanel } from "./MeetingPerformancePanel";
import { useFunnelHealth } from "@/modules/analytics";

interface PipeWhatsappAnalyticsProps {
  items: any[];
  /** Janela da coorte (segue o seletor de período; "Geral" = janela ampla). */
  range: { start: Date; end: Date };
  responsibleMembers: { id: string; name: string }[];
}

export function PipeWhatsappAnalytics({ items, range, responsibleMembers }: PipeWhatsappAnalyticsProps) {
  // Mesma fonte da aba Saúde (RPC get_funnel_health). Usamos as etapas de
  // "Entraram" até "Compareceram" — apresentadas no formato dos analytics do
  // funil (cards + funil contínuo + taxas), não no formato de tabela da Saúde.
  const { data: health } = useFunnelHealth(range, []);
  const s = health?.stages;
  const entraram = s?.entraram ?? 0;
  const avaliados = s?.avaliados ?? 0;
  const bons = s?.bons ?? 0;
  const reuniao = s?.reuniao ?? 0;
  const compareceram = s?.compareceram ?? 0;

  const pct = (to: number, from: number) => (from > 0 ? `${((to / from) * 100).toFixed(0)}%` : undefined);

  // Funil — etapas de Saúde (Entraram → Compareceram)
  const funnelStages = useMemo(
    () => [
      { key: "entraram", label: "Entraram", count: entraram },
      { key: "avaliados", label: "Avaliados", count: avaliados },
      { key: "bons", label: "Bons leads", count: bons },
      { key: "reuniao", label: "Reunião marcada", count: reuniao },
      { key: "compareceram", label: "Compareceram", count: compareceram },
    ],
    [entraram, avaliados, bons, reuniao, compareceram]
  );

  // Conversões entre etapas (mesma semântica da Saúde)
  const conversions = useMemo(
    () => [
      { label: "Entraram → Avaliados", from: entraram, to: avaliados },
      { label: "Avaliados → Bons", from: avaliados, to: bons },
      { label: "Bons → Reunião", from: bons, to: reuniao },
      { label: "Reunião → Compareceu", from: reuniao, to: compareceram },
    ],
    [entraram, avaliados, bons, reuniao, compareceram]
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

  return (
    <div className="space-y-6">
      {/* Stat cards — uma por etapa do funil de Saúde */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <AnalyticsStatCard label="Entraram" value={entraram} sub="no período" accent="neutral" />
        <AnalyticsStatCard
          label="Avaliados"
          value={avaliados}
          sub={pct(avaliados, entraram) && `${pct(avaliados, entraram)} dos que entraram`}
          accent="blue"
          delay={0.05}
        />
        <AnalyticsStatCard
          label="Bons leads"
          value={bons}
          sub={pct(bons, avaliados) && `${pct(bons, avaliados)} dos avaliados`}
          accent="success"
          delay={0.1}
        />
        <AnalyticsStatCard
          label="Reunião marcada"
          value={reuniao}
          sub={pct(reuniao, bons) && `${pct(reuniao, bons)} dos bons`}
          accent="gold"
          delay={0.15}
        />
        <AnalyticsStatCard
          label="Compareceram"
          value={compareceram}
          sub={pct(compareceram, reuniao) && `${pct(compareceram, reuniao)} das reuniões`}
          accent="gold"
          tintValue
          delay={0.2}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <AnalyticsPanel title="Saúde do Funil" subtitle="Volume por etapa e perda entre etapas">
          <ContinuousFunnel stages={funnelStages} unit="leads" />
        </AnalyticsPanel>

        <AnalyticsPanel title="Taxa de Conversão" subtitle="Saúde de cada passagem do funil" dot="success">
          <ConversionHealth items={conversions} />
        </AnalyticsPanel>

        <AnalyticsPanel title="Leads por Origem" subtitle="Distribuição do período" dot="blue">
          <OriginDonut slices={originData} unit="leads" />
        </AnalyticsPanel>

        <MeetingPerformancePanel responsibleMembers={responsibleMembers} />
      </div>
    </div>
  );
}
