import * as React from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Busca em pílula do V5 — a que encosta à direita da fileira de `FilterChip`
 * em Disparos, Copilot, Automações e Templates. Ponte até existir primitivo em
 * `components/ui`.
 */
interface PillSearchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onValueChange: (value: string) => void;
  /** Variante sobre tinta (InkPanel). */
  onInk?: boolean;
}

export function PillSearch({ value, onValueChange, className, placeholder = "Buscar", onInk = false, ...props }: PillSearchProps) {
  return (
    <label className={cn("relative block min-w-0", className)}>
      <span className="sr-only">{props["aria-label"] ?? placeholder}</span>
      <Search
        className={cn(
          "pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2",
          onInk ? "text-tinta-muted" : "text-muted-foreground",
        )}
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "h-[34px] w-full rounded-full border pl-9 pr-3.5 text-xs focus-visible:outline-none focus-visible:ring-2",
          onInk
            ? "border-white/10 bg-white/[.06] text-tinta-foreground placeholder:text-tinta-muted focus-visible:ring-primary"
            : "border-input bg-card text-foreground shadow-relevo placeholder:text-muted-foreground focus-visible:ring-ring",
        )}
        {...props}
      />
    </label>
  );
}

/** A fileira de filtros: quebra no desktop, faixa que rola no celular (regra 7). */
export function FilterRow({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
