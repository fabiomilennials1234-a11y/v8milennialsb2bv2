/**
 * WizardProgress — o trilho de passos do Wizard Linear de Disparos (#904).
 *
 * Forma V5 (mockup "Novo disparo"): seis botões-passo em linha, cada um com o
 * rótulo micro "PASSO N" e o nome. O atual em tinta com o número em ouro; os
 * feitos com ✓; os futuros quietos. Um trilho ouro de 3 px embaixo enche até o
 * passo atual. Passos já alcançados são clicáveis para voltar.
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
  const pct = LAST_STEP_INDEX > 0 ? ((index + 1) / (LAST_STEP_INDEX + 1)) * 100 : 0;

  return (
    <div className="w-full">
      <ol className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 scrollbar-hide">
        {DISPARO_STEPS.map((step, i) => {
          const isActive = i === index;
          const isDone = i < index;
          const isReached = i <= furthest;
          return (
            <li key={step.id} className="min-w-[132px] flex-1">
              <button
                type="button"
                disabled={!isReached || i === index}
                onClick={() => onJump(i)}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-3 text-left transition-colors duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                  isActive && "bg-tinta text-tinta-foreground shadow-relevo-tinta",
                  !isActive && isReached && "hover:bg-muted/60",
                )}
              >
                <span
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] font-extrabold tabular-nums",
                    isActive && "border-transparent bg-primary text-primary-foreground",
                    isDone && "border-transparent bg-primary-soft text-primary-soft-foreground",
                    !isActive && !isDone && "border-border text-muted-foreground",
                  )}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block text-[9.5px] font-bold uppercase tracking-[.1em]",
                      isActive ? "text-tinta-muted" : "text-muted-foreground",
                    )}
                  >
                    Passo {i + 1}
                  </span>
                  <span
                    className={cn(
                      "block truncate text-[13px] font-bold leading-tight",
                      isActive ? "text-tinta-foreground" : isReached ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {step.label}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="relative mt-3 h-[3px] w-full overflow-hidden rounded-full bg-muted">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}
