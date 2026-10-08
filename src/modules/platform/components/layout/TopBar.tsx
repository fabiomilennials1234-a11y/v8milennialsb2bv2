/**
 * Barra superior do V5 — primeira linha da área de trabalho, rola com a página.
 *
 *   [ organização ]   [ pílula da página ]   [ busca ⌘K · sino · tema · eu ]
 *
 * A pílula NÃO é desenhada aqui: o `PageHeader` de cada tela a publica no
 * centro por portal (`PageTabsSlotProvider`), e a barra só oferece o lugar.
 * Assim a navegação da página fica onde o olho já está — no topo — sem que
 * cada tela precise conhecer a barra.
 *
 * Abaixo de 1080 px a barra quebra e a pílula desce para uma linha própria,
 * de largura total e rolável.
 */

import { Moon, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useThemeTransition } from "@/contexts/ThemeTransitionContext";
import { cn } from "@/lib/utils";
import { useCommandPalette } from "@/modules/platform/components/command/useCommandPalette";
import { AlertsDropdown } from "@/modules/platform/components/notifications/AlertsDropdown";
import { OrgChip } from "./OrgSwitcher";
import { SidebarUserMenu } from "./SidebarUserMenu";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function TopBar({
  onTabsSlot,
  compact = false,
  className,
}: {
  /** Recebe o elemento onde a pílula da página é publicada. */
  onTabsSlot: (el: HTMLDivElement | null) => void;
  /** Celular: chip só com o ladrilho, sem o nome; busca só ícone. */
  compact?: boolean;
  className?: string;
}) {
  const { open: openPalette } = useCommandPalette();
  const { resolvedTheme } = useTheme();
  const themeTransition = useThemeTransition();
  const isDark = resolvedTheme === "dark";

  return (
    <div
      role="banner"
      className={cn("flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2.5", className)}
      data-testid="top-bar"
    >
      <OrgChip compact={compact} />

      <div
        ref={onTabsSlot}
        data-slot="page-tabs"
        className={cn(
          "flex min-w-0 flex-1 justify-center empty:min-w-0",
          // Estreito: a pílula ganha linha própria, alinhada à esquerda.
          "max-[1079px]:order-last max-[1079px]:basis-full max-[1079px]:justify-start",
        )}
      />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => openPalette()}
          aria-label="Buscar ações, conversas e leads"
          aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
          className={cn(
            "inline-flex h-[38px] items-center gap-2 rounded-xl border border-card-border bg-card px-3 text-[13px] text-muted-foreground shadow-relevo transition-shadow",
            "hover:shadow-relevo-alto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !compact && "min-[1600px]:min-w-[220px]",
          )}
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          {!compact && (
            <span className="hidden flex-1 text-left min-[1600px]:inline">Buscar ações, conversas, leads…</span>
          )}
          {!compact && (
            <kbd className="rounded-md bg-muted px-1.5 py-0.5 font-sans text-[10.5px] font-semibold text-foreground/70">
              {isMac ? "⌘" : "Ctrl"} K
            </kbd>
          )}
        </button>

        <AlertsDropdown triggerVariant="outline" />

        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label={isDark ? "Usar tema claro" : "Usar tema escuro"}
              onClick={() => themeTransition?.requestThemeChange(isDark ? "light" : "dark")}
            >
              {isDark ? <Sun /> : <Moon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isDark ? "Tema claro" : "Tema escuro"}</TooltipContent>
        </Tooltip>

        <SidebarUserMenu variant="chip" />
      </div>
    </div>
  );
}
