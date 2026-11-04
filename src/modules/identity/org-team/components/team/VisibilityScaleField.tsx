import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface VisibilityScaleOption<L extends string> {
  level: L;
  label: string;
  description: string;
}

/**
 * Escala ordinal de alcance como controle segmentado — o padrão visual de
 * "Visualização de leads" e de "Visualização no Funil".
 *
 * Segmentado porque a grandeza é ordinal: cada passo à direita mostra
 * estritamente mais do que o anterior. `forcedLevel` é o caso derivado: o
 * controle fica desabilitado e exibe um nível que NÃO é o gravado (o Funil nunca
 * é mais largo que Leads); `forcedNotice` explica por quê.
 */
export function VisibilityScaleField<L extends string>({
  title,
  options,
  level,
  forcedLevel,
  forcedNotice,
  disabled,
  onChange,
  footer,
}: {
  title: string;
  options: readonly VisibilityScaleOption<L>[];
  level: L;
  forcedLevel?: L;
  forcedNotice?: ReactNode;
  disabled: boolean;
  onChange: (level: L) => void;
  footer?: ReactNode;
}) {
  const isForced = forcedLevel !== undefined;
  const shown = isForced ? forcedLevel : level;
  const active = options.find((o) => o.level === shown);
  const locked = disabled || isForced;

  return (
    <div className={cn("px-4 py-3", disabled && "opacity-50")}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold">{title}</span>
          <p className="mt-0.5 text-xs text-muted-foreground">{active?.description}</p>
        </div>

        <div
          className={cn(
            "inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted p-[3px]",
            isForced && "opacity-60",
          )}
          role="radiogroup"
          aria-label={title}
          aria-disabled={locked}
        >
          {options.map((option) => {
            const isActive = option.level === shown;
            return (
              <button
                key={option.level}
                type="button"
                role="radio"
                aria-checked={isActive}
                disabled={locked}
                onClick={() => onChange(option.level)}
                className={cn(
                  "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                  isActive
                    ? "bg-card text-foreground shadow-relevo"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {isForced && !disabled && forcedNotice && (
        <p className="mt-2 rounded-xl bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {forcedNotice}
        </p>
      )}

      {footer}
    </div>
  );
}
