/**
 * Pitstop — a coluna que substitui o menu "Mais".
 *
 * Acima de `PITSTOP_OVERLAY_BREAKPOINT` é uma coluna aninhada que empurra o
 * conteúdo; abaixo disso vira overlay, porque a 1024px a coluna deixaria só
 * ~506px de conteúdo e o Kanban de Funis não cabe nisso.
 *
 * O painel NÃO fecha ao navegar: comparar Comissões com Ranking sem reabrir o
 * painel a cada troca é justamente o atrito que o menu "Mais" cobrava.
 */

import { useEffect } from "react";
import { X } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useViewport } from "@/shared/hooks/use-viewport";
import { PITSTOP_OVERLAY_BREAKPOINT, type PitstopGroup } from "@/modules/platform/lib/navigation-model";
import { SidebarNavItem } from "./SidebarNavItem";

interface PitstopPanelProps {
  open: boolean;
  onClose: () => void;
  groups: PitstopGroup[];
  isActive: (path: string) => boolean;
  /** Onde o overlay começa: largura da lateral + as margens dela (V5). */
  overlayLeft?: number;
}

export function PitstopPanel({ open, onClose, groups, isActive, overlayLeft = 272 }: PitstopPanelProps) {
  const { width } = useViewport();
  // width é undefined no primeiro paint (SSR-safe): tratar como desktop evita
  // o painel piscar como overlay antes da medição.
  const asOverlay = width !== undefined && width < PITSTOP_OVERLAY_BREAKPOINT;

  useEffect(() => {
    if (!open || !asOverlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, asOverlay, onClose]);

  if (!open || groups.length === 0) return null;

  const panel = (
    <aside
      aria-label="Pitstop"
      // V5: a coluna também flutua — mesma tinta, mesmo raio e respiro da lateral.
      style={asOverlay ? { left: overlayLeft } : undefined}
      className={cn(
        "my-3 ml-3 flex h-[calc(100vh-1.5rem)] w-[268px] shrink-0 flex-col overflow-hidden rounded-panel border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-relevo-tinta",
        asOverlay && "fixed inset-y-0 z-40 m-0 my-3 backdrop-blur-xl",
      )}
    >
      <div className="flex items-center gap-2 border-b border-sidebar-border px-4 py-3">
        <h2 className="flex-1 text-base font-bold tracking-tight text-sidebar-foreground">Pitstop</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar Pitstop"
          className="grid h-7 w-7 place-items-center rounded-full border border-sidebar-border text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <nav className="flex flex-col gap-1 px-2.5 pb-4 pt-2">
          {groups.map((group) => (
            <div key={group.id} className="mb-1">
              <p className="px-2.5 pb-1 pt-3 font-mono text-[9.5px] uppercase tracking-[0.16em] text-sidebar-foreground/40">
                {group.title}
              </p>
              <p className="px-2.5 pb-1 text-[11px] text-sidebar-foreground/40">{group.hint}</p>
              {group.items.map((item) => (
                <SidebarNavItem
                  key={item.path}
                  item={item}
                  active={isActive(item.path)}
                  collapsed={false}
                  compact
                />
              ))}
            </div>
          ))}
        </nav>
      </ScrollArea>
    </aside>
  );

  if (!asOverlay) return panel;

  return (
    <>
      {/* O scrim não é botão: ter dois controles com o mesmo nome acessível
          ("Fechar Pitstop") faz leitor de tela anunciar alvo duplicado. Fechar
          por teclado é o Escape, tratado acima; o alvo nomeado é o X. */}
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-30 cursor-default bg-background/70 backdrop-blur-sm"
      />
      {panel}
    </>
  );
}
