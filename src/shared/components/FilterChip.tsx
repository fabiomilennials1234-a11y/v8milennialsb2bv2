import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * O chip de filtro do V5 (`.chip` do mockup): pílula branca de 34 px com
 * sombra, que vira tinta quando o filtro está ligado. Serve aos dois gestos
 * que as telas de lista repetem — o filtro que liga/desliga (Hoje, Atrasadas)
 * e o gatilho de menu (Origem ▾, Dono da conta ▾).
 *
 * Ponte até o primitivo existir em `components/ui`: a forma mora aqui, num
 * lugar só, para Leads, Funis e Carteira não desenharem cada um o seu.
 *
 * Não decide semântica: quem liga/desliga passa `aria-pressed`; quem abre
 * menu usa como `asChild` do gatilho (o Radix põe `aria-expanded`).
 */
export interface FilterChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  /** Ícone à esquerda (14 px; ouro quando ativo). */
  icon?: React.ElementType;
  /** Contagem em chip pequeno à direita — tinta; ouro quando ativo. */
  count?: React.ReactNode;
  /** Seta de menu: o chip abre uma lista. */
  caret?: boolean;
  /** Quadradinho de cor (funil, segmento). Cor literal de dado, não de tema. */
  swatch?: string | null;
}

export const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(
  ({ active = false, icon: Icon, count, caret, swatch, className, children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      data-active={active || undefined}
      className={cn(
        "inline-flex h-[34px] shrink-0 items-center gap-[7px] whitespace-nowrap rounded-full border px-3 text-xs font-semibold",
        "transition-[background-color,border-color,color] duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
        // No escuro a tinta fica a um degrau do cartão e o chip ligado se
        // perderia: inverte, como o `Button variant="ink"`.
        active
          ? "border-tinta bg-tinta text-tinta-foreground shadow-relevo-tinta dark:border-foreground dark:bg-foreground dark:text-background"
          : "border-input bg-card text-foreground/80 shadow-relevo hover:border-foreground/20 hover:text-foreground",
        Icon || swatch ? "pl-3" : "pl-3.5",
        className,
      )}
      {...props}
    >
      {swatch && <span aria-hidden className="size-2 shrink-0 rounded-[3px]" style={{ background: swatch }} />}
      {Icon && (
        <Icon
          aria-hidden
          className={cn("size-3.5 shrink-0", active ? "text-primary dark:text-background/70" : "text-muted-foreground")}
        />
      )}
      {children}
      {count != null && (
        <span
          className={cn(
            "inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[10.5px] font-extrabold tabular-nums",
            active ? "bg-primary text-primary-foreground" : "bg-tinta text-tinta-foreground",
          )}
        >
          {count}
        </span>
      )}
      {caret && (
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 shrink-0", active ? "text-tinta-muted dark:text-background/60" : "text-muted-foreground")}
        />
      )}
    </button>
  ),
);
FilterChip.displayName = "FilterChip";
