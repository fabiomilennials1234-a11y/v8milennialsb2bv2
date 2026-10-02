/**
 * Layout da área Master.
 *
 * V5 (onda "mais perto do mockup", 02/10): sem lateral própria. A área Master
 * é uma página com o aviso vermelho de que tudo aqui vale para TODAS as
 * organizações, a pílula de grupos e o segmentado das sub-páginas
 * (`MasterNav`). O shell em volta (trilho e barra superior do app) é do
 * roteamento em `App.tsx`; enquanto a rota não estiver dentro dele, este
 * layout desenha a bancada e o "Voltar ao app" sozinho.
 *
 * O padding da página mora no <main>; as páginas não somam o próprio.
 */

import { Outlet, useNavigate } from "react-router-dom";
import { ArrowLeft, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMasterAuth } from "../hooks/useMasterAuth";
import { MasterNav } from "./MasterSidebar";

export function MasterLayout() {
  const navigate = useNavigate();
  const { masterUser, isOutbounder } = useMasterAuth();

  return (
    <div className="min-h-screen bg-background" data-layout="main">
      <main className="mx-auto flex w-full min-w-0 max-w-[1600px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft />
            Voltar ao app
          </Button>
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
      </main>
    </div>
  );
}
