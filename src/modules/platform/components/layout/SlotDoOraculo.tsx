/**
 * O slot do Oráculo na lateral, na forma que o degrau mandou.
 *
 * A altura vem do degrau e nunca do conteúdo: é isso que impede o gargalo do
 * dia de empurrar a navegação. Texto longo é cortado com reticências, não
 * quebrado em mais linhas.
 *
 * No degrau `icone` o rótulo sai da tela mas não da árvore de acessibilidade —
 * 36px de ícone mudo é adivinhação, mesmo argumento do `SidebarNavItem`
 * recolhido. O gargalo, que ali não caberia, vai para a dica flutuante.
 */

import { Sparkles } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ALTURA_POR_DEGRAU,
  type DegrauDoSlot,
} from "@/modules/platform/lib/slot-do-oraculo";

export interface SlotDoOraculoProps {
  degrau: Exclude<DegrauDoSlot, "ausente">;
  /** O gargalo do dia. `null` enquanto não houver briefing. */
  gargalo: string | null;
  onAbrir: () => void;
}

export function SlotDoOraculo({ degrau, gargalo, onAbrir }: SlotDoOraculoProps) {
  const ehIcone = degrau === "icone";

  const alvo = (
    <button
      type="button"
      onClick={onAbrir}
      aria-label={ehIcone ? "Oráculo" : undefined}
      className={cn(
        "group relative flex h-full w-full overflow-hidden rounded-lg text-left",
        "border border-sidebar-border/60 bg-sidebar-accent/30",
        "transition-colors hover:bg-sidebar-accent/60",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60",
        ehIcone
          ? "items-center justify-center"
          : degrau === "card"
            ? "flex-col items-start justify-start p-3"
            : "items-center gap-2 px-2.5",
      )}
    >
      <span
        className={cn(
          "flex items-center gap-2 overflow-hidden",
          !ehIcone && "w-full",
        )}
      >
        <span className="relative shrink-0">
          <Sparkles className="h-4 w-4 text-primary" />
          {/* Marcador: há algo novo esperando. No ícone é o único sinal que
              sobra, então ele não pode depender do texto. */}
          {gargalo && (
            <span
              data-testid="marcador-do-oraculo"
              className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-sidebar"
            />
          )}
        </span>
        {!ehIcone && <span className="truncate text-[13px] font-medium">Oráculo</span>}
      </span>

      {!ehIcone && gargalo && (
        <span
          className={cn(
            "block w-full text-[12px] text-sidebar-foreground/70",
            degrau === "card" ? "mt-1.5 line-clamp-3" : "truncate",
          )}
        >
          {gargalo}
        </span>
      )}
    </button>
  );

  return (
    <div
      data-testid="slot-do-oraculo"
      data-degrau={degrau}
      style={{ height: ALTURA_POR_DEGRAU[degrau] }}
      className="shrink-0 overflow-hidden px-2.5 pb-1"
    >
      {ehIcone ? (
        <Tooltip>
          <TooltipTrigger asChild>{alvo}</TooltipTrigger>
          <TooltipContent side="right">
            <span className="font-medium">Oráculo</span>
            {gargalo && (
              <span className="mt-0.5 block max-w-[220px] text-muted-foreground">
                {gargalo}
              </span>
            )}
          </TooltipContent>
        </Tooltip>
      ) : (
        alvo
      )}
    </div>
  );
}
