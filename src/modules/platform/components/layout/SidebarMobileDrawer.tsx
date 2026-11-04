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
import { useLocation } from "react-router-dom";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNavigationModel } from "@/modules/platform/hooks/useNavigationModel";
import { OrgSwitcher } from "./OrgSwitcher";
import { SidebarBrand } from "./SidebarBrand";
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

  return (
    <>
      {/* V5: o topo escuro (hambúrguer + título + sino + uma lupa que levava a
          /faq) saiu. O topo do celular é a mesma barra clara do desktop, em
          versão compacta (`TopBar compact`, montada pelo MainLayout); a gaveta
          abre pelo "Mais" da barra inferior (evento `v8:open-mobile-nav`). */}
      <Sheet open={open} onOpenChange={setOpen}>
        {/* Mesma âncora de cor do `<aside>` do desktop (ver Sidebar.tsx): a gaveta
            também pinta `bg-sidebar`, escuro nos dois temas, então sem
            `text-sidebar-foreground` os filhos sem cor própria herdam
            `--foreground` e somem no tema claro. */}
        <SheetContent
          side="left"
          className="flex w-[min(280px,86vw)] flex-col gap-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground p-0"
        >
          <div className="flex flex-col gap-3 border-b border-sidebar-border px-3 py-4">
            <SidebarBrand collapsed={false} />
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

              {/* O link solto de "/configuracoes" saiu: o grupo "Configurações"
                  do Pitstop agora lista cada aba na própria rota, e manter os
                  dois deixava a mesma palavra duas vezes na gaveta. */}
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
