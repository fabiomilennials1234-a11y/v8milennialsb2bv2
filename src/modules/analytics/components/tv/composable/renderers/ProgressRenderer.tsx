import { formatMetricValue } from "@/modules/analytics/lib/tv-metric-format";

interface ProgressRendererProps {
  /** Valor atual da medida (do motor). */
  value: number | null | undefined;
  /**
   * Alvo/meta. OPCIONAL. No S1 o motor NÃO serve alvo (a meta legada vinha da
   * tabela goals, fora do motor — decisão Cais mode (b)). Sem alvo, o corpo
   * degrada HONESTO: some (null), e o valor de cabeça do frame é o widget — nunca
   * um gauge com meta inventada. O gauge real entra quando o motor servir alvo.
   */
  target?: number | null;
  formatId?: string | null;
  /** tube (termômetro) | bar (barra) | radial (velocímetro). Default tube. */
  variant?: string | null;
}

/**
 * Progresso-para-meta (#1253, spec §2.1 #5): valor ÷ alvo. div/CSS (+conic no
 * radial), sem recharts. Fill em gold (`--primary`, o canal do valor que importa);
 * trilho em `--muted`. Cap visual em 100%, mas o rótulo mostra o % real.
 *
 * SEM ALVO (caso do S1) → retorna null: degrada para Número (o frame já mostra o
 * valor de cabeça). Não desenha gauge de meta que não existe.
 */
export function ProgressRenderer({ value, target, formatId, variant }: ProgressRendererProps) {
  // Degradação honesta (S1): sem alvo utilizável, não há progresso a desenhar.
  if (target === null || target === undefined || !Number.isFinite(target) || target <= 0) return null;
  if (value === null || value === undefined || Number.isNaN(value)) return null;

  const ratio = value / target;
  const pct = Math.max(0, Math.min(ratio, 1)) * 100;
  const pctLabel = `${Math.round(ratio * 100)}%`;
  const fill = "hsl(var(--primary))";
  const track = "hsl(var(--muted))";
  const grow = "var(--tv-dur-base) var(--tv-ease-out)";

  const caption = (
    <div className="mt-2 flex items-baseline justify-between" style={{ fontSize: "var(--tv-label)" }}>
      <span className="font-semibold tabular-nums text-foreground">{formatMetricValue(value, formatId)}</span>
      <span className="text-muted-foreground tabular-nums">
        {pctLabel} · {formatMetricValue(target, formatId)}
      </span>
    </div>
  );

  if (variant === "radial") {
    return (
      <div className="flex h-full flex-col justify-center">
        <div className="relative mx-auto aspect-square w-full max-w-[9em]">
          <div
            className="h-full w-full rounded-full"
            style={{ background: `conic-gradient(${fill} ${pct}%, ${track} ${pct}% 100%)`, transition: `background ${grow}` }}
          />
          <div className="absolute inset-[18%] flex items-center justify-center rounded-full" style={{ background: "hsl(var(--tv-surface, var(--background)))" }}>
            <span className="font-bold tabular-nums text-foreground" style={{ fontSize: "var(--tv-value-sm)" }}>{pctLabel}</span>
          </div>
        </div>
        {caption}
      </div>
    );
  }

  if (variant === "bar") {
    return (
      <div className="flex h-full flex-col justify-center">
        <div className="w-full overflow-hidden rounded-full" style={{ height: "0.9em", backgroundColor: track }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: fill, transition: `width ${grow}` }} />
        </div>
        {caption}
      </div>
    );
  }

  // tube (default): termômetro vertical.
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="mx-auto flex items-end" style={{ height: "70%" }}>
        <div className="relative w-[1.4em] overflow-hidden rounded-full" style={{ height: "100%", backgroundColor: track }}>
          <div className="absolute bottom-0 left-0 right-0 rounded-full" style={{ height: `${pct}%`, backgroundColor: fill, transition: `height ${grow}` }} />
        </div>
      </div>
      {caption}
    </div>
  );
}
