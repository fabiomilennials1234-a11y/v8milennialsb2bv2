/**
 * Uma linha da lateral.
 *
 * Três formas possíveis, decididas por props e não pelo chamador:
 * link normal, item trancado por plano (abre upgrade) e pai expansível.
 * Quando a lateral está recolhida o rótulo vira tooltip — sem isso, 64px de
 * ícone mudo é adivinhação.
 */

import { NavLink } from "react-router-dom";
import { ChevronRight, Lock } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { NavNode } from "@/modules/platform/lib/navigation-model";

interface SidebarNavItemProps {
  item: NavNode;
  active: boolean;
  collapsed: boolean;
  locked?: boolean;
  /** Presente só em pais expansíveis. */
  expanded?: boolean;
  onToggleExpand?: () => void;
  onLockedClick?: () => void;
  onHoverPrefetch?: () => void;
  /**
   * Troca o link por um botão: o item deixa de navegar e passa a acionar algo
   * na própria tela. Usado pela Agenda, que abre painel sobreposto em vez de
   * trocar de página. `active` continua vindo de fora — só que do estado do
   * painel, não da rota.
   */
  onActivate?: () => void;
  /** Espelha o estado do que `onActivate` abre, para leitor de tela. */
  activateExpanded?: boolean;
  /** Conteúdo à direita do rótulo (contador, chip de data). */
  trailing?: React.ReactNode;
  /** Substitui o ícone — usado pela Agenda, que mostra o dia de hoje. */
  leading?: React.ReactNode;
  compact?: boolean;
  /**
   * Trilho de ícones do V5 (lateral de 76 px): botão 46×42, só ícone, rótulo
   * no tooltip, trilho dourado colado na borda da lateral.
   */
  rail?: boolean;
  /** Selo no canto do ícone: número ou só um ponto. */
  badge?: number | "dot";
}

const rowClasses = (active: boolean, compact: boolean, rail = false) =>
  cn(
    "group relative flex items-center text-left transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar",
    rail
      ? "h-[42px] w-[46px] shrink-0 justify-center rounded-[14px]"
      : cn("w-full gap-3 rounded-xl px-2.5", compact ? "py-1.5 text-[13px]" : "py-2 text-sm"),
    // V5: o ativo é a superfície clara da tinta + ícone em ouro + trilho
    // dourado com brilho. O ouro deixa de pintar o rótulo inteiro.
    active
      ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground [&>svg:not([data-chevron])]:text-primary"
      : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground",
  );

/** Barra de 4px que marca o item ativo, colada na borda da lateral. */
function ActiveRail({ active, rail = false }: { active: boolean; rail?: boolean }) {
  if (!active) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/.65)]",
        // No trilho o botão fica centrado com 15 px de folga até a borda.
        rail ? "-left-[15px]" : "-left-2.5",
      )}
    />
  );
}

function RailBadge({ badge }: { badge: number | "dot" }) {
  if (badge === "dot") {
    return (
      <span
        aria-hidden
        className="absolute right-[7px] top-[7px] h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-primary"
      />
    );
  }
  if (badge <= 0) return null;
  return (
    <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full border-2 border-sidebar bg-primary px-1 text-[9px] font-extrabold tabular-nums text-primary-foreground">
      {badge > 99 ? "99+" : badge}
    </span>
  );
}

export function SidebarNavItem({
  item,
  active,
  collapsed,
  locked = false,
  expanded,
  onToggleExpand,
  onLockedClick,
  onHoverPrefetch,
  onActivate,
  activateExpanded,
  trailing,
  leading,
  compact = false,
  rail = false,
  badge,
}: SidebarNavItemProps) {
  const Icon = item.icon;
  const isParent = typeof expanded === "boolean";
  if (rail) collapsed = true;

  const inner = (
    <>
      <ActiveRail active={active} rail={rail} />
      {leading ?? (
        <Icon
          className={cn(rail ? "h-[19px] w-[19px]" : "h-[17px] w-[17px]", "shrink-0", locked && "opacity-50")}
          strokeWidth={rail ? 1.7 : undefined}
          style={item.color ? { color: item.color } : undefined}
        />
      )}
      {rail && badge !== undefined && <RailBadge badge={badge} />}
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && locked && <Lock className="h-3 w-3 shrink-0 text-amber-500/70" />}
      {!collapsed && trailing}
      {!collapsed && isParent && !locked && (
        <ChevronRight
          data-chevron
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-sidebar-foreground/40 transition-transform",
            expanded && "rotate-90",
          )}
        />
      )}
    </>
  );

  let row: React.ReactNode;

  if (locked) {
    row = (
      <button
        type="button"
        onClick={onLockedClick}
        aria-label={collapsed ? `${item.label} (bloqueado no plano)` : undefined}
        className={rowClasses(false, compact, rail)}
      >
        {inner}
      </button>
    );
  } else if (onActivate) {
    row = (
      <button
        type="button"
        onClick={onActivate}
        aria-expanded={activateExpanded}
        // Recolhida, o rótulo visível some e sobra um ícone mudo. O link tem o
        // href pra se identificar; um botão não tem nada.
        aria-label={item.label}
        className={rowClasses(active, compact, rail)}
      >
        {inner}
      </button>
    );
  } else if (isParent && item.expandOnly) {
    // Pai sem tela-índice (Turbo): navegar levaria a um redirect que remonta o
    // layout e apaga o estado de expansão. Aqui o clique só abre o grupo.
    row = (
      <button
        type="button"
        onClick={onToggleExpand}
        onMouseEnter={onHoverPrefetch}
        aria-expanded={expanded}
        // Recolhida, o rótulo visível some e sobra um ícone mudo. O link tem o
        // href pra se identificar; um botão não tem nada.
        aria-label={item.label}
        className={rowClasses(active, compact, rail)}
      >
        {inner}
      </button>
    );
  } else if (isParent) {
    // O pai navega E expande no mesmo clique: a rota-índice existe, e obrigar
    // dois cliques para chegar nela é o atrito que a lateral vem matar.
    row = (
      <NavLink
        to={item.path}
        onClick={onToggleExpand}
        onMouseEnter={onHoverPrefetch}
        className={rowClasses(active, compact, rail)}
      >
        {inner}
      </NavLink>
    );
  } else {
    row = (
      <NavLink
        to={item.path}
        onMouseEnter={onHoverPrefetch}
        aria-label={collapsed ? item.label : undefined}
        className={rowClasses(active, compact, rail)}
      >
        {inner}
      </NavLink>
    );
  }

  if (!collapsed) return row;

  return (
    <Tooltip delayDuration={120}>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={rail ? 14 : 10}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}
