import { memo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

/**
 * InactivePipeChip — dashed chip representing a pipe the lead is *not*
 * currently in. Click opens a tiny popover with a confirm button to add
 * the lead to that pipe. Parent handles the actual mutation; this chip
 * only owns the popover + loading visuals.
 */
interface InactivePipeChipProps {
  label: string;
  shortLabel: string;
  isAdding: boolean;
  onAdd: () => Promise<void> | void;
  testId?: string;
  /** Optional override copy when the action isn't yet possible (e.g. upsell). */
  disabled?: boolean;
  disabledReason?: string;
}

export const InactivePipeChip = memo(function InactivePipeChip({
  label,
  shortLabel,
  isAdding,
  onAdd,
  testId,
  disabled,
  disabledReason,
}: InactivePipeChipProps) {
  const [open, setOpen] = useState(false);

  const handleAdd = async () => {
    await onAdd();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId ?? `inactive-pipe-chip-${shortLabel}`}
          className={cn(
            "group inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full",
            "border border-dashed border-border/50 bg-transparent",
            "text-[11px] font-medium text-muted-foreground",
            "hover:border-solid hover:border-primary/40 hover:bg-primary/[0.04] hover:text-foreground",
            "transition-[colors,border-style] duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <span
            className="w-1 h-1 rounded-full bg-muted-foreground/40 group-hover:bg-primary transition-colors"
            aria-hidden
          />
          <span>{shortLabel}</span>
          <Plus
            className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <p className="text-xs text-muted-foreground mb-2">
          Adicionar lead a{" "}
          <span className="text-foreground font-medium">{label}</span>?
        </p>
        {disabled ? (
          <p className="text-[11px] text-muted-foreground/70">
            {disabledReason ?? "Indisponível neste momento."}
          </p>
        ) : (
          <Button
            size="sm"
            className="w-full gap-1.5"
            onClick={handleAdd}
            disabled={isAdding}
            data-testid={`inactive-pipe-chip-confirm-${shortLabel}`}
          >
            {isAdding ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            Adicionar
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
});
