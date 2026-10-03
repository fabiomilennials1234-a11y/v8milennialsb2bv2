/**
 * Layout da área Master.
 *
 * V5 (onda "mais perto do mockup", 02/10): mora DENTRO do shell normal do app
 * (trilho de ícones + barra superior — `App.tsx` monta `MainLayout` em volta),
 * sem lateral própria. O que fica aqui é o que diz "você está na camada de
 * cima": o selo do modo master, a pílula de grupos e o segmentado das
 * sub-páginas (`MasterNav`) e a faixa vermelha de que tudo vale para TODAS as
 * organizações.
 *
 * O padding da página mora no <main> do `MainLayout`; as páginas não somam o
 * próprio.
 */

import { Outlet } from "react-router-dom";
import { Shield } from "lucide-react";
import { useMasterAuth } from "../hooks/useMasterAuth";
import { MasterNav } from "./MasterSidebar";

export function MasterLayout() {
  const { masterUser, isOutbounder } = useMasterAuth();

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 text-xs font-bold text-destructive-foreground shadow-[0_8px_24px_-8px_hsl(var(--destructive)/.7)]">
          <Shield className="h-3.5 w-3.5" aria-hidden />
          {isOutbounder ? "Painel Outbound" : "Modo master"}
        </span>
        <span className="ml-auto truncate text-xs text-muted-foreground max-sm:hidden">
          {masterUser?.notes || "Master User"} · todas as ações são logadas
        </span>
      </div>

      <MasterNav />

      {/* Faixa vermelha: o que se faz aqui atravessa organizações. */}
      <p
        role="note"
        className="flex items-start gap-2 rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-2.5 text-[12.5px] font-semibold text-destructive"
      >
        <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Camada master · o que você fizer aqui vale para todas as organizações e fica na auditoria.
      </p>

      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
