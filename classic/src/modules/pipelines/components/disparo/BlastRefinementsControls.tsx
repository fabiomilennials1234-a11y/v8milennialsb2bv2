import { Minus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import type { BlastRefinements } from "./useBlastPreview";

const MIN_DAYS = 1;
const MAX_DAYS = 90;

interface BlastRefinementsControlsProps {
  value: BlastRefinements;
  onChange: (next: BlastRefinements) => void;
  disabled?: boolean;
}

/**
 * Two refinement toggles for the Blast Audience (#704), styled after Linear's
 * settings rows: a clear label + one-line helper on the left, the control
 * right-aligned. The recency toggle reveals an inline number stepper.
 */
export function BlastRefinementsControls({
  value,
  onChange,
  disabled,
}: BlastRefinementsControlsProps) {
  function setDays(next: number) {
    onChange({ ...value, recentDays: Math.min(MAX_DAYS, Math.max(MIN_DAYS, next)) });
  }

  return (
    <div className="space-y-3">
      <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Refinar público
      </Label>

      <div className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/70">
        {/* Recency exclusion */}
        <div className="flex items-start justify-between gap-4 px-4 py-3.5">
          <div className="min-w-0 space-y-1.5">
            <label
              htmlFor="refine-recent"
              className="block text-sm font-medium leading-none text-foreground"
            >
              Excluir quem já recebeu disparo
            </label>
            <p className="text-[11px] leading-tight text-muted-foreground">
              Pula leads contatados num disparo recente — evita martelar o mesmo número.
            </p>

            {value.excludeRecent && (
              <DaysStepper
                value={value.recentDays}
                onChange={setDays}
                disabled={disabled}
              />
            )}
          </div>
          <Switch
            id="refine-recent"
            checked={value.excludeRecent}
            onCheckedChange={(checked) => onChange({ ...value, excludeRecent: checked })}
            disabled={disabled}
            className="mt-0.5"
          />
        </div>

        {/* Non-responders only */}
        <div className="flex items-start justify-between gap-4 px-4 py-3.5">
          <div className="min-w-0 space-y-1.5">
            <label
              htmlFor="refine-nonresponders"
              className="block text-sm font-medium leading-none text-foreground"
            >
              Só quem não respondeu
            </label>
            <p className="text-[11px] leading-tight text-muted-foreground">
              Mantém apenas quem nunca respondeu desde o último disparo — foca em silenciosos.
            </p>
          </div>
          <Switch
            id="refine-nonresponders"
            checked={value.onlyNonResponders}
            onCheckedChange={(checked) => onChange({ ...value, onlyNonResponders: checked })}
            disabled={disabled}
            className="mt-0.5"
          />
        </div>
      </div>
    </div>
  );
}

/** Compact inline stepper for the recency window (days). */
function DaysStepper({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[11px] text-muted-foreground">nos últimos</span>
      <div className="inline-flex h-8 items-stretch overflow-hidden rounded-md border border-border bg-background">
        <StepButton
          ariaLabel="Diminuir dias"
          disabled={disabled || value <= MIN_DAYS}
          onClick={() => onChange(value - 1)}
        >
          <Minus className="h-3 w-3" />
        </StepButton>
        <input
          type="number"
          inputMode="numeric"
          min={MIN_DAYS}
          max={MAX_DAYS}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
          aria-label="Janela em dias"
          className="w-10 border-x border-border bg-transparent text-center text-sm font-medium tabular-nums outline-none [appearance:textfield] focus-visible:bg-muted/40 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <StepButton
          ariaLabel="Aumentar dias"
          disabled={disabled || value >= MAX_DAYS}
          onClick={() => onChange(value + 1)}
        >
          <Plus className="h-3 w-3" />
        </StepButton>
      </div>
      <span className="text-[11px] text-muted-foreground">{value === 1 ? "dia" : "dias"}</span>
    </div>
  );
}

function StepButton({
  children,
  onClick,
  disabled,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-7 items-center justify-center text-muted-foreground transition-colors",
        "hover:bg-muted/60 hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}
