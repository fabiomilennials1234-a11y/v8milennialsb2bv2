import { Target } from "lucide-react";

/**
 * Pílula que sinaliza a aba Projeção como cenário de meta (DESIGN §5).
 * Cor warning para diferenciar inconfundivelmente do dado real.
 */
export function ScenarioBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-warning">
      <Target className="h-3 w-3" aria-hidden="true" />
      Cenário · Meta
    </span>
  );
}
