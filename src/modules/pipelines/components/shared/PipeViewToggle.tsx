import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PipeViewOption<T extends string> {
  value: T;
  icon: LucideIcon;
  label: string;
}

interface PipeViewToggleProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: PipeViewOption<T>[];
  /** Unique id so the sliding indicator doesn't collide with other toggles. */
  layoutId: string;
}

/**
 * Segmented control com indicador deslizante ("esteira"): uma pílula de fundo
 * que anima entre os botões via shared layout animation do framer-motion.
 */
export function PipeViewToggle<T extends string>({
  value,
  onChange,
  options,
  layoutId,
}: PipeViewToggleProps<T>) {
  return (
    <div className="flex items-center border rounded-lg p-1">
      {options.map(({ value: optValue, icon: Icon, label }) => {
        const active = value === optValue;
        return (
          <button
            key={optValue}
            type="button"
            onClick={() => onChange(optValue)}
            title={label}
            aria-pressed={active}
            className={cn(
              "relative inline-flex items-center justify-center h-8 w-9 rounded-md transition-colors outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
              active ? "text-secondary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-md bg-secondary shadow-sm shadow-black/5"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <Icon className="w-4 h-4 relative z-10" />
          </button>
        );
      })}
    </div>
  );
}
