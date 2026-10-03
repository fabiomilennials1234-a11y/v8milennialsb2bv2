import { WidgetFrame } from "@/modules/analytics/components/tv/composable/WidgetFrame";
import { TVWidgetBody } from "@/modules/analytics/components/tv/composable/TVWidgetBody";
import { TVGrid, TVGridCell } from "@/modules/analytics/components/tv/composable/TVGrid";
import { headValueFromMeasure, type MetricSeriesPoint } from "@/modules/analytics/lib/tv-series";
import type { TvChartType } from "@/modules/analytics/lib/tv-chart-type";

/**
 * Demo dev-only dos renderers da TV (#1218). Rota PÚBLICA `/tv-renderers-demo`
 * (irmã de `/tv-type-scale`), com FIXTURES — sem auth, sem DB, sem prod.
 *
 * Razão: os renderers são data-agnósticos. Esta página exercita barra/linha/donut
 * com dados conhecidos, para validar leitura a 3m e o invariante "valor de cabeça
 * bate com a soma visível" sem depender de sessão de banco. É AID DE QA — não
 * ship: guardada por import.meta.env.DEV; some do bundle de produção.
 */

const money = (label: string, value: number): MetricSeriesPoint => ({ key: label, label, value });

const closers = [
  money("Marina", 412000),
  money("Caio", 288000),
  money("Rafa", 201000),
  money("Bea", 96000),
  money("Léo", 54000),
  money("Duda", 31000),
  money("Ana", 12000), // 6ª+ → colapsa em "Outros"
];

const dailyLeads: MetricSeriesPoint[] = Array.from({ length: 22 }, (_, i) => ({
  key: `d${i + 1}`,
  label: `${i + 1}/08`,
  value: Math.round(20 + 15 * Math.sin(i / 3) + i),
}));

const streams = [money("Novo negócio", 640000), money("Carteira", 372000)];

const origins = [
  money("Meta Ads", 180),
  money("Site", 92),
  money("Indicação", 61),
  money("Google", 44),
  money("Remarketing", 20),
  money("Outros canais", 15),
];

interface DemoCase {
  eyebrow: string;
  chartType: TvChartType;
  series: MetricSeriesPoint[] | null;
  formatId: string;
  weight?: "hero" | "primary" | "secondary";
  anchor: string;
  emptyReason?: string | null;
  col: number; row: number; w: number; h: number;
}

const CASES: DemoCase[] = [
  { eyebrow: "Receita por closer", chartType: "bar", series: closers, formatId: "currency_brl",
    weight: "primary", anchor: "fechamentos", col: 0, row: 0, w: 4, h: 3 },
  { eyebrow: "Leads criados no tempo", chartType: "line", series: dailyLeads, formatId: "integer",
    weight: "primary", anchor: "entradas", col: 4, row: 0, w: 5, h: 3 },
  { eyebrow: "Receita por fluxo", chartType: "donut", series: streams, formatId: "currency_brl",
    weight: "primary", anchor: "fechamentos", col: 9, row: 0, w: 3, h: 3 },
  { eyebrow: "Leads por origem", chartType: "donut", series: origins, formatId: "integer",
    weight: "secondary", anchor: "entradas", col: 0, row: 3, w: 3, h: 3 },
  { eyebrow: "Vendas por SDR (1 categoria)", chartType: "bar", series: [money("Marina", 8)], formatId: "integer",
    weight: "secondary", anchor: "fechamentos", col: 3, row: 3, w: 3, h: 3 },
  { eyebrow: "Reuniões (sem registros)", chartType: "bar", series: [], formatId: "integer",
    weight: "secondary", anchor: "entradas", emptyReason: "no_rows", col: 6, row: 3, w: 3, h: 3 },
  { eyebrow: "Ticket médio", chartType: "number", series: null, formatId: "currency_brl",
    weight: "hero", anchor: "fechamentos", col: 9, row: 3, w: 3, h: 3 },
];

export default function TvRenderersDemo() {
  if (!import.meta.env.DEV) {
    return <div style={{ padding: 24 }}>Indisponível em produção.</div>;
  }

  return (
    <div data-surface="tv" className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <TVGrid>
        {CASES.map((c) => {
          const measure = { value: c.chartType === "number" ? 8450 : null, series: c.series, empty_reason: c.emptyReason };
          return (
            <TVGridCell key={c.eyebrow} placement={{ col: c.col, row: c.row, w: c.w, h: c.h }}>
              <WidgetFrame
                eyebrow={c.eyebrow}
                weight={c.weight}
                value={headValueFromMeasure(measure)}
                formatId={c.formatId}
                anchor={c.anchor}
                periodLabel="08/2027"
                emptyReason={c.emptyReason}
              >
                <TVWidgetBody chartType={c.chartType} measure={measure} formatId={c.formatId} />
              </WidgetFrame>
            </TVGridCell>
          );
        })}
      </TVGrid>
    </div>
  );
}
