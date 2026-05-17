import { memo, useState, useRef, useCallback } from "react";
import { Flame } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * LeadCardCalor — ícone de fogo com arrasto vertical (hover slide) pra
 * definir o calor do lead (1-10).
 *
 * Comportamento:
 *  • Click → abre popover compacto.
 *  • Mouse down + drag vertical no ícone → ajusta valor em tempo real.
 *  • Solte para confirmar.
 *
 * Formato e cor mudam conforme intensidade (frio → quente).
 */

const TIERS = [
  { min: 1, max: 3, label: "Frio",   sizeClass: "w-3 h-3",  color: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/30" },
  { min: 4, max: 6, label: "Morno",  sizeClass: "w-3.5 h-3.5", color: "text-amber-400", bg: "bg-amber-500/10",  border: "border-amber-500/30" },
  { min: 7, max: 8, label: "Quente", sizeClass: "w-4 h-4",  color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30" },
  { min: 9, max: 10,label: "Ardente",sizeClass: "w-4 h-4",  color: "text-red-500",    bg: "bg-red-500/15",    border: "border-red-500/50" },
] as const;

function tierForValue(v: number) {
  return TIERS.find((t) => v >= t.min && v <= t.max) ?? TIERS[0];
}

interface LeadCardCalorProps {
  calor: number;
  onChange?: (value: number) => void;
  className?: string;
}

export const LeadCardCalor = memo(function LeadCardCalor({ calor, onChange, className }: LeadCardCalorProps) {
  const [open, setOpen] = useState(false);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragOriginY = useRef<number | null>(null);
  const dragOriginValue = useRef<number>(calor);

  const display = dragValue ?? calor;
  const tier = tierForValue(display);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    dragOriginY.current = e.clientY;
    dragOriginValue.current = calor;
    setDragValue(calor);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [calor]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragOriginY.current === null) return;
    const dy = dragOriginY.current - e.clientY; // up = positive
    const stepPx = 8; // px per unit
    const delta = Math.round(dy / stepPx);
    const next = Math.min(10, Math.max(1, dragOriginValue.current + delta));
    setDragValue(next);
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    if (dragOriginY.current === null) return;
    const finalValue = dragValue ?? calor;
    dragOriginY.current = null;
    setDragValue(null);
    if (finalValue !== calor) {
      onChange?.(finalValue);
    } else {
      setOpen((v) => !v);
    }
  }, [dragValue, calor, onChange]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Calor: ${display} (${tier.label})`}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 select-none cursor-ns-resize transition-all",
            tier.bg,
            tier.border,
            dragValue !== null && "scale-110 shadow-lg",
            className,
          )}
        >
          <Flame
            className={cn(tier.sizeClass, tier.color, "transition-all")}
            style={{ filter: display >= 9 ? "drop-shadow(0 0 4px currentColor)" : undefined }}
          />
          <span className={cn("text-[10px] font-semibold tabular-nums", tier.color)}>{display}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-3"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-2">
          <Flame className={cn("w-4 h-4", tier.color)} />
          <span className="text-xs font-semibold">{tier.label}</span>
          <span className={cn("ml-auto text-base font-bold", tier.color)}>{display}</span>
        </div>
        <p className="text-[10px] text-muted-foreground mb-2">
          Arraste o ícone do fogo pra cima/baixo no card pra ajustar. Ou use os botões:
        </p>
        <div className="grid grid-cols-10 gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
            const isActive = n === display;
            return (
              <button
                key={n}
                type="button"
                onClick={() => onChange?.(n)}
                className={cn(
                  "h-6 rounded text-[10px] font-semibold transition-colors",
                  isActive
                    ? cn(tier.bg, tier.color, tier.border, "border")
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {n}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
});
