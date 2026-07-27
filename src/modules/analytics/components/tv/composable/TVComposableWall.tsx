import { useMemo } from "react";
import { TVGrid, TVGridCell } from "./TVGrid";
import { WidgetFrame, type WidgetWeight } from "./WidgetFrame";
import { TVWidgetBody } from "./TVWidgetBody";
import { resolveChartType } from "@/modules/analytics/lib/tv-chart-type";
import { headValueFromMeasure } from "@/modules/analytics/lib/tv-series";
import { useDashboardPages } from "@/modules/analytics/hooks/useComposableDashboard";
import { useDashboardSnapshot, type DashboardWidgetSnapshot } from "@/modules/analytics/hooks/useDashboardSnapshot";
import { useMetricCatalog } from "@/modules/analytics/hooks/useMetricCatalog";
import { applyDensityCeiling } from "@/modules/analytics/lib/tv-density";

/**
 * Âncora estática dos renderers LEGADOS. Não é mapa de medida→âncora (isso é
 * proibido no front, §4.2) — célula legada não tem medida no motor. A spec §8.4.2
 * é explícita: "os 2 legados sabem a própria âncora — é string estática, não vem
 * do motor. Custo ≈ zero." Some junto com o legado no v2.
 */
const LEGACY_ANCHOR: Record<string, string> = {
  "legacy:thermometer": "fechamentos",
  "legacy:closer-performance": "fechamentos",
};

interface CatalogLabels {
  measure: Record<string, string>;
  recorte: Record<string, string>;
  renderer: Record<string, string>;
}

/** Eyebrow = a pergunta. Gerada de medida + recorte, com override curto opcional. */
function buildEyebrow(w: DashboardWidgetSnapshot, labels: CatalogLabels): string {
  if (w.eyebrow_override) return w.eyebrow_override;

  if (w.measure_kind === "legacy" && w.renderer_id) {
    return labels.renderer[w.renderer_id] ?? w.renderer_id;
  }

  const m = w.measure;
  const base =
    m?.kind === "ratio"
      ? // Razão: nomeia pelo par, que é o que o usuário montou.
        `${labels.measure[m.num?.measure_id ?? ""] ?? m.num?.measure_id ?? ""} / ${
          labels.measure[m.den?.measure_id ?? ""] ?? m.den?.measure_id ?? ""
        }`
      : labels.measure[m?.measure_id ?? ""] ?? m?.measure_id ?? "";

  const recorte = w.recorte_id && w.recorte_id !== "total" ? labels.recorte[w.recorte_id] ?? w.recorte_id : null;
  return recorte ? `${base} por ${recorte}` : base;
}

/**
 * A parede montável. Desenha a partir do painel PERSISTIDO, via o instantâneo:
 * UMA chamada por atualização, não uma por widget.
 *
 * Widget quebrado degrada sozinho — o painel continua (§5.3). Se um widget
 * sumisse, a grid dançaria e o espectador acharia que alguém mudou a tela.
 */
export function TVComposableWall({ period = "month" as const }: { period?: "day" | "week" | "month" | "range" }) {
  const { data: pages, isLoading: pagesLoading } = useDashboardPages("tv");
  const { data: catalog } = useMetricCatalog();

  // Rotação entre páginas é #1222. Aqui a casca desenha a primeira.
  const pageId = pages?.[0]?.id ?? null;

  const snapshot = useDashboardSnapshot({ pageId, period });

  const labels = useMemo<CatalogLabels>(() => {
    const measure: Record<string, string> = {};
    const recorte: Record<string, string> = {};
    const renderer: Record<string, string> = {};
    catalog?.measures?.forEach((m) => (measure[m.id] = m.label));
    catalog?.recortes?.forEach((r) => (recorte[r.id] = r.label));
    catalog?.renderers?.forEach((r) => (renderer[r.id] = r.label));
    return { measure, recorte, renderer };
  }, [catalog]);

  // Teto de densidade (§6.4). O excedente não é escondido em silêncio: o motor
  // distribui em páginas novas (#1222). Encolher tipografia nunca é a saída.
  const { visible, overflow } = useMemo(
    () => applyDensityCeiling(snapshot.data?.widgets ?? []),
    [snapshot.data?.widgets],
  );

  if (import.meta.env.DEV && overflow.length > 0) {
    console.warn(
      `[TVComposableWall] ${overflow.length} widget(s) acima do teto de densidade — vão para página nova (#1222).`,
    );
  }

  const loading = pagesLoading || (snapshot.isLoading && !snapshot.data);

  return (
    <TVGrid>
      {visible.map((w) => {
        const errored = Boolean(w.error);
        const isLegacy = w.measure_kind === "legacy";
        const m = w.measure;

        // Estilo (#1253): widget_style escolhido VENCE; null → deriva do recorte.
        // Célula legada remanescente (multi-medida, v2) segue sem corpo.
        const chartType = isLegacy ? "number" : resolveChartType(w.recorte_id, w.widget_style);
        // value_format ?? format_id enquanto durar o EXPAND (#1253); DROP é o S7.
        const valueFormat = w.value_format ?? w.format_id;
        // Valor de cabeça: escalar do motor, ou soma da série (§1② — todo formato
        // tem valor de cabeça). empty_reason é honrado no WidgetFrame.
        const headValue = isLegacy ? null : headValueFromMeasure(m);

        return (
          <TVGridCell
            key={w.widget_id}
            placement={{ col: w.grid?.col ?? 0, row: w.grid?.row ?? 0, w: w.grid?.w ?? 1, h: w.grid?.h ?? 1 }}
            pinned={w.pinned}
          >
            <WidgetFrame
              eyebrow={buildEyebrow(w, labels)}
              weight={(w.weight ?? "secondary") as WidgetWeight}
              value={headValue}
              formatId={valueFormat}
              state={errored ? "error" : loading ? "loading" : "ready"}
              // Célula legada: âncora estática; o corpo legado entra na #1219.
              anchor={isLegacy ? LEGACY_ANCHOR[w.renderer_id ?? ""] : m?.anchor}
              periodLabel={m?.provenance?.period_label}
              recorte={w.recorte_id}
              recorteLabel={w.recorte_id ? labels.recorte[w.recorte_id] : undefined}
              stream={(w.filters as { stream?: string } | undefined)?.stream}
              emptyReason={m?.empty_reason}
            >
              {!errored && !isLegacy && (
                <TVWidgetBody chartType={chartType} measure={m} formatId={valueFormat} styleVariant={w.style_variant} />
              )}
            </WidgetFrame>
          </TVGridCell>
        );
      })}
    </TVGrid>
  );
}
