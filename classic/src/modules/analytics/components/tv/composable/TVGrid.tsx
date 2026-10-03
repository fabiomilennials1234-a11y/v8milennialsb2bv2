import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GRID_COLS, GRID_ROWS } from "@/modules/analytics/lib/tv-density";

export interface GridPlacement {
  col: number; // 0-based
  row: number; // 0-based
  w: number;
  h: number;
}

/**
 * Grid 12×6 — a FONTE ÚNICA de layout da parede (spec §9.1), incluindo as células
 * `pinned`. Nenhum widget é posicionado fora dela.
 *
 * Se os legados vivessem fora, a parede teria dois sistemas de posicionamento e o
 * Comando herdaria a bagunça quando o arrasto chegar (§8.4.3). Com tudo dentro,
 * matar o legado no v2 é trocar um id de renderer — não é re-diagramar a parede.
 *
 * SEM ROLAGEM. A TV de hoje esconde conteúdo atrás de `overflow-y-auto`, que numa
 * parede é conteúdo que ninguém rola (§8.4.6). O excesso vira página, não scroll.
 */
export function TVGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("grid h-full w-full overflow-hidden", className)}
      style={{
        gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${GRID_ROWS}, minmax(0, 1fr))`,
        gap: "20px",
        padding: "24px",
      }}
    >
      {children}
    </div>
  );
}

/** Célula do grid. `pinned` é marcação semântica — a posição fixa vem dos dados. */
export function TVGridCell({
  placement,
  pinned,
  children,
}: {
  placement: GridPlacement;
  pinned?: boolean;
  children: ReactNode;
}) {
  const col = Math.max(0, Math.min(GRID_COLS - 1, placement.col ?? 0));
  const row = Math.max(0, Math.min(GRID_ROWS - 1, placement.row ?? 0));
  const w = Math.max(1, Math.min(GRID_COLS - col, placement.w ?? 1));
  const h = Math.max(1, Math.min(GRID_ROWS - row, placement.h ?? 1));

  return (
    <div
      className="min-h-0 min-w-0"
      data-pinned={pinned ? "true" : undefined}
      style={{
        gridColumn: `${col + 1} / span ${w}`,
        gridRow: `${row + 1} / span ${h}`,
      }}
    >
      {children}
    </div>
  );
}
