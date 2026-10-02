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
 */

import { Outlet } from "react-router-dom";
import { MasterSidebar } from "./MasterSidebar";
import { Shield } from "lucide-react";

export function MasterLayout() {
  return (
    <div className="flex h-screen bg-background" data-layout="main">
      <MasterSidebar />

      <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden md:overflow-x-auto">
        {/* Master Mode Indicator — a faixa externa não captura clique; só a pílula. */}
        <div className="pointer-events-none sticky top-0 z-20 flex justify-center px-4 pt-3">
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-destructive px-4 py-1.5 text-xs font-semibold text-destructive-foreground shadow-[0_8px_24px_-8px_hsl(var(--destructive)/.7)]">
            <Shield className="h-3.5 w-3.5" aria-hidden />
            <span>Modo Master Admin — acesso total ao sistema</span>
          </div>
        </div>

        <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
