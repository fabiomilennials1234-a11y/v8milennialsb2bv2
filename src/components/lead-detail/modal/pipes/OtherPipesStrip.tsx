import { memo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InactivePipeChip } from "./InactivePipeChip";

/**
 * OtherPipesStrip — bottom row of dashed chips for pipes the lead is *not*
 * currently in. Replaces the empty-state branches that used to live in
 * each accordion section. Keeps the discovery affordance compact.
 *
 * Wraps up to 2 lines; once the strip would exceed ~8 chips it collapses
 * the overflow into a `+N` chip whose popover lists the remaining pipes
 * vertically.
 */

export interface InactivePipeDescriptor {
  key: string;
  label: string;
  shortLabel: string;
  /** When true, render disabled with a tooltip-like reason. */
  disabled?: boolean;
  disabledReason?: string;
  /** Used to surface a per-chip loading spinner. */
  isAdding: boolean;
  onAdd: () => Promise<void> | void;
  testId?: string;
}

interface OtherPipesStripProps {
  inactive: InactivePipeDescriptor[];
  /** Max chips rendered inline before collapsing into "+N". */
  visibleLimit?: number;
}

export const OtherPipesStrip = memo(function OtherPipesStrip({
  inactive,
  visibleLimit = 8,
}: OtherPipesStripProps) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  if (inactive.length === 0) return null;

  const visible = inactive.slice(0, visibleLimit);
  const hidden = inactive.slice(visibleLimit);

  return (
    <div
      className="flex items-center gap-2 flex-wrap pt-2 mt-1 border-t border-border/40"
      data-testid="other-pipes-strip"
    >
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold mr-1">
        Adicionar a
      </span>
      {visible.map((pipe) => (
        <InactivePipeChip
          key={pipe.key}
          label={pipe.label}
          shortLabel={pipe.shortLabel}
          isAdding={pipe.isAdding}
          onAdd={pipe.onAdd}
          disabled={pipe.disabled}
          disabledReason={pipe.disabledReason}
          testId={pipe.testId}
        />
      ))}
      {hidden.length > 0 && (
        <Popover open={overflowOpen} onOpenChange={setOverflowOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="other-pipes-strip-more"
              className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border border-dashed border-border/50 bg-transparent text-[11px] font-medium text-muted-foreground hover:border-solid hover:border-primary/40 hover:bg-primary/[0.04] hover:text-foreground transition-[colors,border-style] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              +{hidden.length}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-2 max-h-72 overflow-y-auto">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold px-1 pb-1">
              Outros pipes
            </p>
            <div className="flex flex-col gap-1">
              {hidden.map((pipe) => (
                <InactivePipeChip
                  key={pipe.key}
                  label={pipe.label}
                  shortLabel={pipe.shortLabel}
                  isAdding={pipe.isAdding}
                  onAdd={pipe.onAdd}
                  disabled={pipe.disabled}
                  disabledReason={pipe.disabledReason}
                  testId={pipe.testId}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
});
