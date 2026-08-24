/**
 * Navegação lateral — substitui a top bar.
 *
 * Seis portas na lateral e quatro no rodapé (Agenda, Notificações, Ajuda,
 * Pitstop). O menu "Mais" deixou de existir: o que vivia nele mora agora dentro
 * do Pitstop, que abre como coluna aninhada ao lado da lateral.
 *
 * O componente não decide visibilidade — isso é `useNavigationModel`. Aqui só
 * se decide forma: recolhida ou não, expandida ou não, tooltip ou rótulo.
 */

import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { ChevronLeft, ChevronRight, HelpCircle, Settings } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { UpgradeModal } from "@/shared/components/UpgradeModal";
import { usePrefetchPipes } from "@/modules/pipelines";
import { AlertsDropdown } from "@/modules/platform/components/notifications/AlertsDropdown";
import { useNavigationModel } from "@/modules/platform/hooks/useNavigationModel";
import { useSidebarCollapsed } from "@/modules/platform/hooks/useSidebarCollapsed";
import {
  SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_COLLAPSED,
} from "@/modules/platform/lib/navigation-model";
import type { FeatureKey } from "@/modules/platform/lib/feature-registry";
import { OrgSwitcher } from "./OrgSwitcher";
import { SidebarBrand } from "./SidebarBrand";
import { SidebarMasterLinks } from "./SidebarMasterLinks";
import { PitstopPanel } from "./PitstopPanel";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarUserMenu } from "./SidebarUserMenu";

/** Dia de hoje dentro do ícone da Agenda — mesmo gesto do calendário nativo. */
function AgendaDateChip() {
  const now = new Date();
  const dia = now.getDate();
  const mes = now.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  return (
    <span className="flex h-[26px] w-[26px] shrink-0 flex-col items-center justify-center rounded-md border-[1.5px] border-primary font-mono leading-none text-primary">
      <span className="text-[11px] tabular-nums">{dia}</span>
      <span className="mt-px text-[6.5px] uppercase tracking-wider">{mes}</span>
    </span>
  );
}

export function Sidebar() {
  const model = useNavigationModel();
  const prefetchPipes = usePrefetchPipes();
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pitstopOpen, setPitstopOpen] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState<FeatureKey | null>(null);

  // Entrar numa rota do Pitstop abre o painel — vindo do teclado, de um link
  // ou de um deep link, o usuário precisa ver onde está.
  useEffect(() => {
    if (model.isPitstopRoute) setPitstopOpen(true);
  }, [model.isPitstopRoute]);

  const toggleExpand = useCallback(
    (label: string) => {
      // Recolhida não há onde desenhar o submenu (`isOpen` exige `!collapsed`).
      // Um grupo que não navega precisa abrir a lateral primeiro, senão o
      // clique não produz nada visível — botão morto.
      if (collapsed) {
        toggleCollapsed();
        setExpanded((prev) => ({ ...prev, [label]: true }));
        return;
      }
      setExpanded((prev) => ({ ...prev, [label]: !prev[label] }));
    },
    [collapsed, toggleCollapsed],
  );

  const openUpgrade = useCallback(
    (path: string) => {
      const key = model.featureKeyFor(path);
      if (key) setUpgradeFeature(key);
    },
    [model],
  );

  const width = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH;

  return (
    <>
      {/* `text-sidebar-foreground` no <aside> não é decoração. A lateral é ESCURA
          nos DOIS temas (`--sidebar-background` = 36 20% 18% no claro), mas quem
          não declarava cor própria herdava `--foreground` — que no tema claro é
          30 18% 16%, praticamente o mesmo tom do fundo: 1.10:1, invisível. Era o
          que apagava o nome da org. Ancorar a cor aqui conserta a herança de todo
          descendente, não só a do seletor. */}
      <aside
        data-testid="sidebar"
        aria-label="Navegação principal"
        style={{ width }}
        className="relative z-30 flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none"
      >
        <div className="flex flex-col gap-3 px-3 pb-2 pt-4">
          {/* O botão de recolher mora aqui dentro, e não flutuando na borda:
              na borda ele cobria o título do Pitstop quando o painel abria. */}
          <div className="flex h-7 items-center gap-2">
            <SidebarBrand collapsed={collapsed} />
            {!collapsed && (
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label="Recolher menu"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
          </div>

          {collapsed && (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Expandir menu"
              className="grid h-7 w-full place-items-center rounded-md text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          {!collapsed && <OrgSwitcher />}
        </div>

        <ScrollArea className="flex-1">
          <nav className="flex flex-col gap-0.5 px-2.5 pb-3 pt-1">
            {model.primary.map((item) => {
              const hasChildren = (item.children?.length ?? 0) > 0;
              const isOpen = !collapsed && hasChildren && !!expanded[item.label];
              const locked = model.isLocked(item.path);

              return (
                <div key={item.path}>
                  <SidebarNavItem
                    item={item}
                    active={model.isActive(item.path)}
                    collapsed={collapsed}
                    locked={locked}
                    expanded={hasChildren ? !!expanded[item.label] : undefined}
                    onToggleExpand={hasChildren ? () => toggleExpand(item.label) : undefined}
                    onLockedClick={() => openUpgrade(item.path)}
                    onHoverPrefetch={item.path === "/funis" ? prefetchPipes : undefined}
                  />

                  {isOpen && (
                    <div className="ml-[19px] mt-0.5 flex flex-col gap-px border-l border-sidebar-border pl-2">
                      {item.children?.map((child) => {
                        const childLocked = model.isLocked(child.path);
                        return (
                          <div key={child.path}>
                            <SidebarNavItem
                              item={child}
                              active={model.isActive(child.path)}
                              collapsed={false}
                              locked={childLocked}
                              onLockedClick={() => openUpgrade(child.path)}
                              compact
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </ScrollArea>

        <div className="flex flex-col gap-0.5 border-t border-sidebar-border p-2.5">
          {model.agenda && (
            <SidebarNavItem
              item={model.agenda}
              active={model.isActive(model.agenda.path)}
              collapsed={collapsed}
              leading={<AgendaDateChip />}
            />
          )}

          {/* O AlertsDropdown traz botão e padding próprios; sem neutralizar,
              o sino desalinha dos outros ícones do rodapé. */}
          <div
            className={cn(
              "flex items-center gap-3 rounded-lg py-2 text-sm text-sidebar-foreground/70",
              "[&_button]:h-auto [&_button]:w-auto [&_button]:p-0 [&_button]:hover:bg-transparent",
              collapsed ? "justify-center" : "px-2.5",
            )}
          >
            <AlertsDropdown />
            {!collapsed && <span className="flex-1 truncate">Notificações</span>}
          </div>

          {/* Master, Gestor e "Ativos agora" — só para quem é master. Vieram do
              topo, de dentro do `OrgSwitcher`, onde a linha transbordava a
              largura da barra e invadia o conteúdo. Aqui eles recolhem junto
              com o menu, o que no topo não acontecia. */}
          <SidebarMasterLinks collapsed={collapsed} />

          {collapsed ? (
            <Tooltip delayDuration={120}>
              <TooltipTrigger asChild>
                <NavLink
                  to="/faq"
                  className="flex items-center justify-center rounded-lg py-2 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                >
                  <HelpCircle className="h-[17px] w-[17px]" />
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={10}>
                Ajuda
              </TooltipContent>
            </Tooltip>
          ) : (
            <NavLink
              to="/faq"
              className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <HelpCircle className="h-[17px] w-[17px] shrink-0" />
              <span className="flex-1 truncate">Ajuda</span>
            </NavLink>
          )}

          {model.pitstop && model.pitstopGroups.length > 0 && (
            <PitstopTrigger
              collapsed={collapsed}
              open={pitstopOpen}
              active={pitstopOpen || model.isPitstopRoute}
              onToggle={() => setPitstopOpen((v) => !v)}
            />
          )}

          <div className="pt-1">
            <SidebarUserMenu collapsed={collapsed} />
          </div>
        </div>
      </aside>

      <PitstopPanel
        open={pitstopOpen}
        onClose={() => setPitstopOpen(false)}
        groups={model.pitstopGroups}
        isActive={model.isActive}
      />

      {upgradeFeature && (
        <UpgradeModal
          open
          onOpenChange={(open) => !open && setUpgradeFeature(null)}
          featureKey={upgradeFeature}
        />
      )}
    </>
  );
}

function PitstopTrigger({
  collapsed,
  open,
  active,
  onToggle,
}: {
  collapsed: boolean;
  open: boolean;
  active: boolean;
  onToggle: () => void;
}) {
  const button = (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary/10 font-semibold text-primary"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <Settings className="h-[17px] w-[17px] shrink-0" />
      {!collapsed && <span className="flex-1 truncate">Pitstop</span>}
      {!collapsed && (
        <ChevronRight
          className={cn("h-3.5 w-3.5 shrink-0 opacity-40 transition-transform", open && "rotate-90")}
        />
      )}
    </button>
  );

  if (!collapsed) return button;

  return (
    <Tooltip delayDuration={120}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        Pitstop
      </TooltipContent>
    </Tooltip>
  );
}

