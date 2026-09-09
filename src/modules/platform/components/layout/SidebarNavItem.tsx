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
}

const rowClasses = (active: boolean, compact: boolean) =>
  cn(
    "group relative flex w-full items-center gap-3 rounded-lg px-2.5 text-left transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar",
    compact ? "py-1.5 text-[13px]" : "py-2 text-sm",
    active
      ? "bg-primary/10 font-semibold text-primary"
      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
  );

/** Barra de 3px que marca o item ativo, colada na borda da lateral. */
function ActiveRail({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span
      aria-hidden
      className="absolute -left-2.5 top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
    />
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
}: SidebarNavItemProps) {
  const Icon = item.icon;
  const isParent = typeof expanded === "boolean";

  const inner = (
    <>
      <ActiveRail active={active} />
      {leading ?? (
        <Icon
          className={cn("h-[17px] w-[17px] shrink-0", locked && "opacity-50")}
          style={item.color ? { color: item.color } : undefined}
        />
      )}
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && locked && <Lock className="h-3 w-3 shrink-0 text-amber-500/70" />}
      {!collapsed && trailing}
      {!collapsed && isParent && !locked && (
        <ChevronRight
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
      <button type="button" onClick={onLockedClick} className={rowClasses(false, compact)}>
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
        className={rowClasses(active, compact)}
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
        className={rowClasses(active, compact)}
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
        className={rowClasses(active, compact)}
      >
        {inner}
      </NavLink>
    );
  } else {
    row = (
      <NavLink
        to={item.path}
        onMouseEnter={onHoverPrefetch}
        className={rowClasses(active, compact)}
      >
        {inner}
      </NavLink>
    );
  }

  if (!collapsed) return row;

  return (
    <Tooltip delayDuration={120}>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}
