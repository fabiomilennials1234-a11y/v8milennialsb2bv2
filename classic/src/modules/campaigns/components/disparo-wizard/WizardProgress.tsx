/**
 * WizardProgress — the top step rail for the Disparos Wizard Linear (#904).
 *
 * Pra quem · Mensagem · Velocidade · Revisão · Acompanhar. The active step
 * carries the gold accent; reached steps are clickable to step back; future
 * steps stay quiet. A single connecting line fills to the current progress —
 * the one load-bearing motion cue, calm Linear/Stripe.
 */
import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { DISPARO_STEPS, LAST_STEP_INDEX } from "./wizard-machine";

interface WizardProgressProps {
  index: number;
  furthest: number;
  onJump: (index: number) => void;
}

export function WizardProgress({ index, furthest, onJump }: WizardProgressProps) {
  const pct = LAST_STEP_INDEX > 0 ? (index / LAST_STEP_INDEX) * 100 : 0;

  return (
    <div className="w-full">
      {/* Rail */}
      <div className="relative">
        <div className="absolute left-0 right-0 top-[11px] h-px bg-border/70" />
        <motion.div
          className="absolute left-0 top-[11px] h-px bg-primary"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        />

        <ol className="relative flex items-start justify-between">
          {DISPARO_STEPS.map((step, i) => {
            const isActive = i === index;
            const isDone = i < index;
            const isReached = i <= furthest;
            return (
              <li key={step.id} className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  disabled={!isReached || i === index}
                  onClick={() => onJump(i)}
                  aria-current={isActive ? "step" : undefined}
                  className={cn(
                    "relative flex h-[22px] w-[22px] items-center justify-center rounded-full border bg-background transition-colors duration-200",
                    isActive && "border-primary text-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]",
                    isDone && "border-primary bg-primary text-primary-foreground",
                    !isActive && !isDone && "border-border text-muted-foreground/60",
                    isReached && i !== index && "cursor-pointer hover:border-primary/60",
                    !isReached && "cursor-default",
                  )}
                >
                  {isDone ? (
                    <Check className="h-3 w-3" strokeWidth={3} />
                  ) : (
                    <span className="text-[11px] font-semibold tabular-nums">{i + 1}</span>
                  )}
                </button>
                <span
                  className={cn(
                    "text-[11px] font-medium tracking-tight transition-colors duration-200 sm:text-xs",
                    isActive ? "text-foreground" : "text-muted-foreground/70",
                  )}
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
