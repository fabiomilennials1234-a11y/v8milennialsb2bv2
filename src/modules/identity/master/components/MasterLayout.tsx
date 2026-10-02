/**
 * Layout específico para área Master
 *
 * Inclui sidebar própria e header com indicador de modo Master.
 *
 * V5: mesma bancada do app (`data-layout="main"` liga a grade de 28px no
 * fundo) e a lateral em tinta flutuante. O sinal vermelho de "Modo Master"
 * continua sempre à vista, agora como pílula fixa no topo da área de trabalho
 * — vermelho é o aviso de que tudo aqui atravessa organizações. O padding da
 * página mora no <main>; as páginas não somam o próprio.
 *
 * Celular: a lateral de 256 px ocupava dois terços da tela a 390. Abaixo de
 * `md` ela vira gaveta, aberta pelo botão ao lado da pílula.
 */

import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Menu, Shield } from "lucide-react";
import { MasterSidebar } from "./MasterSidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

export function MasterLayout() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex h-screen bg-background" data-layout="main">
      <div className="hidden md:flex">
        <MasterSidebar />
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0 [&>button]:text-sidebar-foreground">
          <SheetTitle className="sr-only">Navegação Master</SheetTitle>
          <MasterSidebar
            className="m-0 h-full w-full rounded-none border-0 shadow-none"
            onNavigate={() => setNavOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden md:overflow-x-auto">
        {/* Master Mode Indicator — a faixa externa não captura clique; só a pílula e o menu. */}
        <div className="pointer-events-none sticky top-0 z-20 flex items-center gap-2 px-4 pt-3 md:justify-center">
          <Button
            variant="ink"
            size="icon"
            className="pointer-events-auto shrink-0 md:hidden"
            aria-label="Abrir navegação Master"
            onClick={() => setNavOpen(true)}
          >
            <Menu />
          </Button>
          <div className="pointer-events-auto inline-flex min-w-0 items-center gap-2 rounded-full bg-destructive px-4 py-1.5 text-xs font-semibold text-destructive-foreground shadow-[0_8px_24px_-8px_hsl(var(--destructive)/.7)]">
            <Shield className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              Modo Master Admin<span className="max-sm:hidden"> — acesso total ao sistema</span>
            </span>
          </div>
        </div>

        <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
