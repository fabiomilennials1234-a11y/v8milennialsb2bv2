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
        <div className="absolute left-0 right-0 top-[10px] h-[3px] rounded-full bg-muted" />
        <motion.div
          className="absolute left-0 top-[10px] h-[3px] rounded-full bg-primary"
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
                    "relative flex h-[22px] w-[22px] items-center justify-center rounded-full border bg-card transition-colors duration-200",
                    // V5: o passo atual é o ouro; os feitos ficam em tinta.
                    isActive && "border-primary bg-primary text-primary-foreground shadow-brilho-ouro",
                    isDone && "border-transparent bg-tinta text-tinta-foreground dark:bg-foreground dark:text-background",
                    !isActive && !isDone && "border-border text-muted-foreground",
                    isReached && i !== index && "cursor-pointer hover:ring-2 hover:ring-primary/40",
                    !isReached && "cursor-default",
                  )}
                >
                  {isDone ? (
                    <Check className="h-3 w-3" strokeWidth={3} />
                  ) : (
                    <span className="text-[11px] font-bold tabular-nums">{i + 1}</span>
                  )}
                </button>
                <span
                  className={cn(
                    "text-[11px] tracking-tight transition-colors duration-200 sm:text-xs",
                    isActive ? "font-bold text-foreground" : "font-semibold text-muted-foreground",
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
