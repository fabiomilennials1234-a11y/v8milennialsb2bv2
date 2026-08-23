/**
 * Gaveta de navegação no celular.
 *
 * Abaixo do breakpoint não existe lateral fixa: a barra de topo tem o
 * hambúrguer e a gaveta traz a navegação inteira — as seis portas, os filhos e
 * o conteúdo do Pitstop, tudo numa rolagem só.
 *
 * Escuta `v8:open-mobile-nav`, o mesmo evento que a `MobileBottomNav` já
 * dispara pelo botão "Mais". Trocar a fonte da gaveta sem manter esse contrato
 * deixaria aquele botão inerte.
 */

import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Menu, Search, Settings } from "lucide-react";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertsDropdown } from "@/modules/platform/components/notifications/AlertsDropdown";
import { useNavigationModel } from "@/modules/platform/hooks/useNavigationModel";
import { OrgSwitcher } from "./OrgSwitcher";
import { SidebarMasterLinks } from "./SidebarMasterLinks";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarUserMenu } from "./SidebarUserMenu";

export function SidebarMobileDrawer() {
  const location = useLocation();
  const model = useNavigationModel();
  const [open, setOpen] = useState(false);

  // Navegou: fecha. Sem isso a gaveta cobre a tela que o usuário acabou de pedir.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("v8:open-mobile-nav", handler);
    return () => window.removeEventListener("v8:open-mobile-nav", handler);
  }, []);

  const title =
    model.primary.find((item) => model.isActive(item.path))?.label ?? "Torque";

  return (
    <>
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-sidebar-border bg-sidebar px-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          className="grid h-8 w-8 place-items-center rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Menu className="h-[18px] w-[18px]" />
        </button>

        <span className="flex-1 truncate text-[15px] font-bold tracking-tight text-sidebar-foreground">
          {title}
        </span>

        <AlertsDropdown />

        <NavLink
          to="/faq"
          aria-label="Ajuda"
          className="grid h-8 w-8 place-items-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent"
        >
          <Search className="h-[17px] w-[17px]" />
        </NavLink>
      </header>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="flex w-[min(280px,86vw)] flex-col gap-0 border-r border-sidebar-border bg-sidebar p-0"
        >
          <div className="flex flex-col gap-3 border-b border-sidebar-border px-3 py-4">
            <div className="flex items-center gap-2.5 px-1">
              <span className="grid h-[26px] w-[26px] place-items-center rounded-md bg-primary text-[14px] font-extrabold text-primary-foreground">
                T
              </span>
              <span className="text-base font-bold tracking-tight text-sidebar-foreground">Torque</span>
            </div>
            <OrgSwitcher />
          </div>

          <ScrollArea className="flex-1">
            <nav className="flex flex-col gap-0.5 px-2.5 py-2">
              {model.primary.map((item) => (
                <div key={item.path}>
                  <SidebarNavItem
                    item={item}
                    active={model.isActive(item.path)}
                    collapsed={false}
                    locked={model.isLocked(item.path)}
                  />
                  {(item.children?.length ?? 0) > 0 && (
                    <div className="ml-[19px] flex flex-col gap-px border-l border-sidebar-border pl-2">
                      {item.children?.map((child) => (
                        <SidebarNavItem
                          key={child.path}
                          item={child}
                          active={model.isActive(child.path)}
                          collapsed={false}
                          locked={model.isLocked(child.path)}
                          compact
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {model.agenda && (
                <SidebarNavItem
                  item={model.agenda}
                  active={model.isActive(model.agenda.path)}
                  collapsed={false}
                />
              )}

              {/* Os atalhos de master saíram do `OrgSwitcher` (que aqui em cima
                  ficou só com a troca de org). Sem esta linha, o master perderia
                  a porta do painel no celular — a regressão silenciosa da
                  mudança, já que o drawer não tem rodapé como o desktop. */}
              <SidebarMasterLinks collapsed={false} />

              {/* No celular o Pitstop não é painel: é o resto da mesma lista. */}
              {model.pitstopGroups.map((group) => (
                <div key={group.id}>
                  <p className="px-2.5 pb-1 pt-3 font-mono text-[9.5px] uppercase tracking-[0.16em] text-sidebar-foreground/40">
                    {group.title}
                  </p>
                  {group.items.map((item) => (
                    <SidebarNavItem
                      key={item.path}
                      item={item}
                      active={model.isActive(item.path)}
                      collapsed={false}
                      compact
                    />
                  ))}
                </div>
              ))}

              {model.pitstop && (
                <NavLink
                  to="/configuracoes"
                  className="mt-2 flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                >
                  <Settings className="h-[17px] w-[17px] shrink-0" />
                  <span>Configurações</span>
                </NavLink>
              )}
            </nav>
          </ScrollArea>

          <div className="border-t border-sidebar-border p-2.5">
            <SidebarUserMenu collapsed={false} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
