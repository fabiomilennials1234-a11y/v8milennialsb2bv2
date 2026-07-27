import { formatMetricValue } from "@/modules/analytics/lib/tv-metric-format";
import { ordinalColor, type MetricSeriesPoint } from "@/modules/analytics/lib/tv-series";

interface FunnelRendererProps {
  /** Estágios NA ORDEM DO FUNIL (não por volume). A ordenação é do dado/motor —
   *  o renderer PRESERVA a ordem recebida; re-ordenar por valor viraria barra. */
  series: MetricSeriesPoint[];
  formatId?: string | null;
  /** bars (barras que afunilam) | trapezoid (bandas centradas). Default bars. */
  variant?: string | null;
}

/** Taxa de conversão entre estágios consecutivos: value[i] / value[i-1]. */
function conversion(prev: number, cur: number): string | null {
  if (!prev || prev <= 0) return null;
  return `${Math.round((cur / prev) * 100)}%`;
}

/**
 * Funil (#1293, spec map §1 card #8). "Quanto passa de uma etapa pra próxima?"
 *
 * O que faz ser FUNIL e não barra deitada: (a) ORDEM DE ESTÁGIO preservada — nunca
 * ordena por volume; (b) TAXA entre etapas explícita. Cor = rampa ORDINAL quente
 * decrescente (§3.4: funil é ordinal, não arco-íris). Largura relativa ao TOPO.
 *
 * RÓTULO + VALOR FORA da barra (como a Barra): barra estreita (etapa de fim de
 * funil) NÃO pode reticenciar o rótulo — reticência em rótulo de etapa é a mesma
 * doença que morreu no número. A barra colorida mostra a geometria; o texto lê ao
 * lado, em largura própria, a 3m independente do tamanho da barra.
 */
export function FunnelRenderer({ series, formatId, variant }: FunnelRendererProps) {
  const stages = series.filter((s) => s.value != null); // preserva ordem
  if (stages.length === 0) return null;
  const top = Math.max(stages[0].value ?? 0, 0);
  const isTrapezoid = variant === "trapezoid";

  return (
    <div className="flex h-full flex-col justify-center gap-1">
      {stages.map((stage, i) => {
        // Largura relativa ao topo do funil; piso de 4% p/ a banda existir no zero.
        const pct = top > 0 ? Math.max((stage.value ?? 0) / top, 0.04) * 100 : 0;
        const rate = i > 0 ? conversion(stages[i - 1].value ?? 0, stage.value ?? 0) : null;
        return (
          <div key={stage.key ?? stage.label}>
            {/* Taxa entre este estágio e o anterior — o que define o funil. */}
            {rate && (
              <div
                className="text-center text-muted-foreground tabular-nums"
                style={{ fontSize: "var(--tv-label)", lineHeight: 1.1 }}
              >
                ↓ {rate}
              </div>
            )}
            <div className="flex items-center gap-3">
              {/* Barra: só a geometria do funil. Trapézio centra a banda. */}
              <div className={isTrapezoid ? "flex min-w-0 flex-1 justify-center" : "min-w-0 flex-1"}>
                <div
                  className="rounded-sm"
                  style={{
                    width: `${pct}%`,
                    minHeight: "1em",
                    backgroundColor: ordinalColor(i),
                    transition: "width var(--tv-dur-base) var(--tv-ease-out)",
                  }}
                />
              </div>
              {/* Rótulo + valor FORA da barra — largura própria, nunca reticencia por barra estreita. */}
              <div className="flex shrink-0 items-baseline gap-2" style={{ fontSize: "var(--tv-label)" }}>
                <span className="max-w-[12ch] truncate text-muted-foreground" title={stage.label}>
                  {stage.label}
                </span>
                <span className="font-semibold tabular-nums text-foreground">
                  {formatMetricValue(stage.value, formatId)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
